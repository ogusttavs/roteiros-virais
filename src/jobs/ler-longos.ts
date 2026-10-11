/**
 * Job `ler-longos` (E52, PR 2, semanal, domingo de manhã, depois do `transcrever` diário e do `comentarios-semana`): a leitura dos vídeos longos do YouTube de cada setor. Por
 * setor, em duas etapas:
 *
 * 1. **Transcrever** os poucos longos da semana (`longosParaLer`: no máximo `longosParaLerPorSemana` por setor, dois por conta na semana, e o teto de minutos de vídeo por semana,
 *    `longosMinutosPorSemana`). Pelo mesmo caminho da fila dos curtos (`transcreverUm`): a legenda do YouTube primeiro (de graça), a Groq só quando falta. O que não sai (sem
 *    legenda e sem chave da Groq, um erro) ganha uma data de nova tentativa e a vaga vai para o próximo da fila na mesma rodada, em até três reposições. Se o proxy recusar (sem
 *    tráfego) o job para na hora; se só "cair" (um engasgo de conexão) são três seguidas, como no diário.
 * 2. **Ler a estrutura** de cada longo já transcrito e ainda sem leitura (`extrairVideoLongo`, modelo barato): a abertura que promete, os capítulos, os laços, onde a pessoa
 *    sairia. A saída passa por `conferirLeituraDoLongo` (tempos dentro do vídeo; os capítulos da descrição do dono por cima dos do modelo) e vai para `videos.analise_longa`. Só
 *    lê o que `longosDoSetor` já escolhe (piso do ramo, janela, fora o de outro idioma): o orçamento dito é um só.
 *
 * O longo nunca entra na ficha de um curto: `videos.analise` fica nula, e a fila do `extrair` (o lote diário) o deixa de fora pelo teto de duração.
 *
 * O custo vai para o ramo: a transcrição pela Groq (`custos_externos`, `fonte: groq`), o tráfego do proxy e a leitura (`geracoes_ia`, `tarefa: extrairVideoLongo`) são gravados com o
 * ramo do setor que está sendo lido, e a aba Custos mostra os três (o bloco "vídeos longos").
 *
 * As datas de nova tentativa são de SEIS dias, não sete: a rodada seguinte nasce segundos antes da hora desta, e com sete dias o vídeo perderia uma semana inteira por segundos.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { contas, nichos, videos } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as extrairVideoLongoIA from "@/ia/prompts/extrairVideoLongo";
import { registrarGeracao } from "@/ia/registro";
import { lerCapitulosDaDescricao } from "@/lib/capitulos-da-descricao";
import { config } from "@/lib/config";
import { logger } from "@/lib/log";
import { custoDoProxyUsd, registrarCustoExterno } from "@/servicos/custos-externos";
import { conferirLeituraDoLongo, transcricaoComTempos } from "@/servicos/leitura-dos-longos";
import { longosDoSetor, longosParaLer } from "@/servicos/videos-longos";

import { definirRamoDoContexto, restaurarRamoDoContexto } from "./contexto-execucao";
import { orcamentoDoSetor, orcamentosDaConfig, type ResultadoVideo, transcreverUm } from "./transcrever";
import { pausaEntreVideosYoutube } from "./youtube-cliente";

const DIA_MS = 24 * 60 * 60 * 1000;
/** Menos que isto de texto transcrito não é um longo falado (música, vinheta, legenda quase vazia): não gasta a leitura. */
export const TEXTO_MINIMO_DO_LONGO = 1200;
/** A nova tentativa do que não saiu: uma semana menos um dia (ver o cabeçalho). */
const NOVA_TENTATIVA_MS = 6 * DIA_MS;
/** A segunda recusa do mesmo vídeo: o texto não mudou e a estrutura não se achou duas vezes; meio ano. */
const NOVA_TENTATIVA_DA_SEGUNDA_RECUSA_MS = 180 * DIA_MS;
/** Um engasgo do proxy não para a semana; três seguidos sem um download bom no meio, sim (a mesma regra do `transcrever` diário). */
const MAX_PROXY_FORA_SEGUIDOS = 3;
/** Quantas vezes a fila é reposta numa rodada quando algum vídeo não saiu: sobra o orçamento da semana sem gastar a vaga em falha. */
const MAX_REPOSICOES = 3;

type VideoParaTranscrever = { id: number; url: string; duracaoS: number; idioma: string | null };

export type DepsLerLongos = {
  agora?: Date;
  /** Os testes entregam a transcrição pronta em vez de abrir o `yt-dlp` e a Groq. `medirBytes` recebe os bytes do áudio baixado (o tráfego do proxy). */
  transcrever?: (video: VideoParaTranscrever, medirBytes: (bytes: number) => void) => Promise<ResultadoVideo>;
  /** Os testes zeram a pausa entre os vídeos do YouTube. */
  pausaEntreVideos?: () => Promise<void>;
  /** Os testes entregam a saída da IA (inclusive a que o código recusa e a que lança) em vez de passar pelo simulador. */
  gerar?: typeof gerarEstruturado;
  /** O relógio do orçamento de tempo, em milissegundos; os testes o adiantam. */
  relogio?: () => number;
};

type VideoParaLer = {
  id: number;
  titulo: string | null;
  descricao: string | null;
  duracaoS: number;
  transcricao: string;
  handle: string | null;
  /** A leitura deste vídeo já foi recusada uma vez (há data de nova tentativa gravada). */
  jaRecusado: boolean;
};

/**
 * Os longos do setor que já têm texto e ainda não têm leitura (nem espera de nova tentativa), os mais fora da curva primeiro. A escolha é a de `longosDoSetor` (piso do ramo, janela,
 * fora o de outro idioma e o fora do ramo): a leitura não tem regra própria, e o orçamento é o da semana.
 */
async function longosParaAnalisar(nichoId: number, agora: Date): Promise<VideoParaLer[]> {
  const doSetor = await longosDoSetor(nichoId, { agora, dias: config.regras.longosMedidaJanelaDias });
  const ids = doSetor
    .filter(
      (v) =>
        v.temTranscricao &&
        !v.temAnaliseLonga &&
        v.classificacao !== "outro" &&
        !(v.proximaTentativaAnaliseLonga && v.proximaTentativaAnaliseLonga.getTime() > agora.getTime()),
    )
    .slice(0, config.regras.longosParaLerPorSemana)
    .map((v) => v.id);
  if (ids.length === 0) return [];

  const linhas = await db()
    .select({
      id: videos.id,
      titulo: videos.titulo,
      descricao: videos.descricao,
      duracaoS: videos.duracaoS,
      transcricao: videos.transcricao,
      handle: contas.handle,
      proximaTentativa: videos.proximaTentativaAnaliseLonga,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(inArray(videos.id, ids), isNotNull(videos.transcricao), sql`char_length(trim(${videos.transcricao})) >= ${TEXTO_MINIMO_DO_LONGO}`));
  const porId = new Map(linhas.map((l) => [l.id, l]));
  return ids.flatMap((id) => {
    const l = porId.get(id);
    return l
      ? [{ id: l.id, titulo: l.titulo, descricao: l.descricao, duracaoS: l.duracaoS ?? 0, transcricao: l.transcricao ?? "", handle: l.handle, jaRecusado: l.proximaTentativa !== null }]
      : [];
  });
}

type DesfechoDaLeitura = "lido" | "recusado" | "falhou";

async function lerUm(video: VideoParaLer, nomeNicho: string, termosNicho: string[], agora: Date, gerar: typeof gerarEstruturado): Promise<DesfechoDaLeitura> {
  const capitulosDaDescricao = lerCapitulosDaDescricao(video.descricao, video.duracaoS);
  try {
    const resultado = await gerar({
      tarefa: "extrairVideoLongo",
      nivel: extrairVideoLongoIA.nivel,
      effort: extrairVideoLongoIA.esforco,
      schema: extrairVideoLongoIA.schema,
      sistemaEstavel: extrairVideoLongoIA.montarSistemaEstavel(),
      entrada: extrairVideoLongoIA.montarEntrada({
        titulo: video.titulo ?? "",
        handle: video.handle,
        descricao: video.descricao,
        duracaoS: video.duracaoS,
        capitulosDaDescricao,
        transcricaoComTempos: transcricaoComTempos(video.transcricao, video.duracaoS),
        nomeNicho,
        termosNicho,
      }),
    });

    await registrarGeracao({
      tarefa: "extrairVideoLongo",
      versaoPrompt: extrairVideoLongoIA.versao,
      modelo: resultado.modelo,
      nivel: extrairVideoLongoIA.nivel,
      entradas: { videoId: video.id },
      saida: resultado.dados,
      uso: {
        tokensEntrada: resultado.tokensEntrada,
        tokensSaida: resultado.tokensSaida,
        tokensCacheLeitura: resultado.tokensCacheLeitura,
        tokensCacheEscrita: resultado.tokensCacheEscrita,
      },
    });

    const analise = conferirLeituraDoLongo(resultado.dados, { duracaoS: video.duracaoS, capitulosDaDescricao, versaoPrompt: extrairVideoLongoIA.versao });
    if (!analise) {
      // A saída não tem estrutura de vídeo longo: nova tentativa em uma semana; na segunda recusa do mesmo vídeo, meio ano (o texto não muda, e a leitura não se acha).
      const espera = video.jaRecusado ? NOVA_TENTATIVA_DA_SEGUNDA_RECUSA_MS : NOVA_TENTATIVA_MS;
      await db()
        .update(videos)
        .set({ proximaTentativaAnaliseLonga: new Date(agora.getTime() + espera) })
        .where(eq(videos.id, video.id));
      return "recusado";
    }

    await db()
      .update(videos)
      .set({ analiseLonga: analise, analiseLongaEm: agora, proximaTentativaAnaliseLonga: null })
      .where(eq(videos.id, video.id));
    return "lido";
  } catch (erro) {
    // A IA fora do ar é transitória e a rotina é semanal: sem data, o vídeo volta na próxima rodada (uma chamada que falha por semana é o custo de não marcar à toa).
    logger.warn({ err: erro, videoId: video.id }, "ler-longos: a leitura do video longo falhou");
    return "falhou";
  }
}

/** Os dados do vídeo que a transcrição precisa, na ordem em que `longosParaLer` os escolheu. */
async function dadosParaTranscrever(ids: number[]): Promise<VideoParaTranscrever[]> {
  if (ids.length === 0) return [];
  const linhas = await db()
    .select({ id: videos.id, url: videos.url, duracaoS: videos.duracaoS, idioma: videos.idioma })
    .from(videos)
    .where(inArray(videos.id, ids));
  const porId = new Map(linhas.map((l) => [l.id, { id: l.id, url: l.url, duracaoS: l.duracaoS ?? 0, idioma: l.idioma }]));
  return ids.flatMap((id) => porId.get(id) ?? []);
}

/** O vídeo que não saiu e que a transcrição não marcou (sem legenda e sem chave da Groq, uma exceção): sem data, voltaria toda semana e tomaria a vaga dos de baixo da fila. */
async function marcarQueNaoSaiu(videoId: number, agora: Date): Promise<void> {
  await db()
    .update(videos)
    .set({ proximaTentativaTranscricao: new Date(agora.getTime() + NOVA_TENTATIVA_MS) })
    .where(eq(videos.id, videoId));
}

/**
 * Com `nichoId`, só aquele setor (o botão "rodar de novo só este ramo" do admin). Sem ele, todos os ativos, na ordem do id. Devolve o resumo que `execucoes_job` guarda.
 */
export async function rodarLerLongos(nichoId?: number, deps: DepsLerLongos = {}): Promise<Record<string, unknown>> {
  const agora = deps.agora ?? new Date();
  const relogio = deps.relogio ?? Date.now;
  const transcrever = deps.transcrever ?? ((v: VideoParaTranscrever, medirBytes: (bytes: number) => void) => transcreverUm(v.id, v.url, "youtube", v.duracaoS, v.idioma, medirBytes));
  const pausa = deps.pausaEntreVideos ?? pausaEntreVideosYoutube;
  const daConfig = orcamentosDaConfig();
  const inicioDoJob = relogio();

  const condicoes = [eq(nichos.ativo, true)];
  if (nichoId !== undefined) condicoes.push(eq(nichos.id, nichoId));
  const setores = await db().select().from(nichos).where(and(...condicoes)).orderBy(nichos.id);

  const resumo = {
    setores: setores.length,
    transcritosPorLegenda: 0,
    transcritosPorGroq: 0,
    minutosTranscritos: 0,
    puladosSemChaveGroq: 0,
    falhasDeTranscricao: 0,
    leiturasGravadas: 0,
    leiturasRecusadas: 0,
    leiturasQueFalharam: 0,
    megabytesPeloProxy: 0,
  };
  const erros: string[] = [];
  const setoresParadosPeloOrcamento: string[] = [];
  let proxyParado: string | null = null;
  /** Falhas "fora do ar" seguidas, sem um download bom no meio. */
  let proxyForaSeguidos = 0;

  try {
    for (const [indice, setor] of setores.entries()) {
      definirRamoDoContexto(setor.id);
      let bytesNoSetor = 0;
      const inicioDoSetor = relogio();
      const orcamentoMs = orcamentoDoSetor(daConfig.porSetorMs, daConfig.totalMs, inicioDoSetor - inicioDoJob, setores.length - indice);
      let estourou = false;
      const tentados = new Set<number>();

      for (let reposicao = 0; reposicao <= MAX_REPOSICOES && !proxyParado && !estourou; reposicao += 1) {
        const ids = (await longosParaLer(setor.id, agora)).filter((id) => !tentados.has(id));
        if (ids.length === 0) break;
        let algumNaoSaiu = false;

        for (const video of await dadosParaTranscrever(ids)) {
          // O orçamento de tempo do setor acabou: o que sobrou fica para a semana seguinte, e o job segue para o próximo setor. Confere antes de cada vídeo, nunca no meio de um.
          if (relogio() - inicioDoSetor >= orcamentoMs) {
            estourou = true;
            setoresParadosPeloOrcamento.push(setor.slug);
            break;
          }
          tentados.add(video.id);

          let resultado: ResultadoVideo;
          try {
            resultado = await transcrever(video, (bytes) => {
              bytesNoSetor += bytes;
            });
          } catch (erro) {
            resumo.falhasDeTranscricao += 1;
            algumNaoSaiu = true;
            erros.push(`video ${video.id} / setor "${setor.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
            await marcarQueNaoSaiu(video.id, agora);
            continue;
          }

          if (resultado.tipo === "legenda" || resultado.tipo === "groq") {
            proxyForaSeguidos = 0;
            if (resultado.tipo === "legenda") resumo.transcritosPorLegenda += 1;
            else resumo.transcritosPorGroq += 1;
            resumo.minutosTranscritos += video.duracaoS / 60;
          } else if (resultado.tipo === "pulado") {
            resumo.puladosSemChaveGroq += 1;
            algumNaoSaiu = true;
            await marcarQueNaoSaiu(video.id, agora);
          } else if (resultado.tipo === "proxyFora") {
            algumNaoSaiu = true;
            // "Sem tráfego" e "recusou o acesso" são definitivos até alguém recarregar: param na hora. "Fora do ar" pode ser um engasgo: só três seguidas.
            proxyForaSeguidos = resultado.motivo === "proxy fora do ar" ? proxyForaSeguidos + 1 : MAX_PROXY_FORA_SEGUIDOS;
            if (proxyForaSeguidos >= MAX_PROXY_FORA_SEGUIDOS) {
              proxyParado = resultado.motivo;
              erros.push(`${resultado.motivo}: a transcricao dos longos do YouTube para aqui (video ${video.id} / setor "${setor.slug}")`);
              break;
            }
          } else {
            // O proxy respondeu (o vídeo é que falhou): a contagem do "fora do ar" recomeça. A data de nova tentativa já foi gravada por `transcreverUm`.
            proxyForaSeguidos = 0;
            resumo.falhasDeTranscricao += 1;
            algumNaoSaiu = true;
            erros.push(`video ${video.id} / setor "${setor.slug}": ${resultado.motivo}`);
          }
          await pausa();
        }

        if (!algumNaoSaiu) break;
      }

      // O tráfego do proxy deste setor, em dólar estimado, com o ramo dito de forma explícita (não depende do contexto da execução).
      if (bytesNoSetor > 0) {
        const megabytes = bytesNoSetor / 1_000_000;
        resumo.megabytesPeloProxy += megabytes;
        await registrarCustoExterno({
          fonte: "proxy",
          custoUsd: custoDoProxyUsd(megabytes),
          unidades: megabytes,
          unidade: "megabytes",
          origemDoCusto: "estimado",
          ramoId: setor.id,
          detalhe: { setor: setor.slug, longos: true },
        });
      }

      // A leitura não passa pelo proxy: um longo já transcrito (numa rodada que o proxy cortou, por exemplo) é lido mesmo com o proxy parado.
      for (const video of await longosParaAnalisar(setor.id, agora)) {
        const desfecho = await lerUm(video, setor.nome, setor.termos, agora, deps.gerar ?? gerarEstruturado);
        if (desfecho === "lido") resumo.leiturasGravadas += 1;
        else if (desfecho === "recusado") resumo.leiturasRecusadas += 1;
        else resumo.leiturasQueFalharam += 1;
      }
    }
  } finally {
    restaurarRamoDoContexto();
  }

  return {
    ...resumo,
    minutosTranscritos: Number(resumo.minutosTranscritos.toFixed(1)),
    megabytesPeloProxy: Number(resumo.megabytesPeloProxy.toFixed(2)),
    youtubePausadoMotivo: proxyParado ?? undefined,
    setoresParadosPeloOrcamento: setoresParadosPeloOrcamento.length > 0 ? setoresParadosPeloOrcamento : undefined,
    erros: erros.length > 0 ? erros : undefined,
  };
}
