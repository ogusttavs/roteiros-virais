/**
 * Job `extrairSemFala` (M3, item 2): para o setor que aceita "vídeo sem fala vale"
 * (`nichos.video_sem_fala_vale`, `reguaDoSetor`), o vídeo acima do piso com transcrição curta
 * demais (`TAMANHO_MINIMO_TRANSCRICAO`, `extracao-comum.ts`) nunca ganha `videos.analise` pelo
 * caminho de sempre (`extrair.ts`/`extrair-agora.ts`, os dois exigem transcrição). Este job baixa
 * o vídeo, extrai quadros (mesma infraestrutura de `analisar-visual.ts`) e manda a tarefa
 * `extrairVideoSemFala`: a mesma ficha fixa de `extrairVideo`, tirada dos quadros e da legenda do
 * post, sem transcrição nenhuma. Diário, com teto próprio (`config.regras.analiseSemFalaPorDia`),
 * separado do semanal de `analisarVisual` (que exige transcrição e análise já prontas: são dois
 * vídeos diferentes, um com fala, outro sem).
 *
 * `videos.idioma` e `videos.tipoAbertura` não são tocados aqui: sem fala não há idioma falado
 * para julgar (o vídeo mantém o valor detectado na coleta por título e descrição) nem sinal
 * confiável de tipo de abertura só com quadros e legenda.
 */
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { nichos, videos, type AnaliseVideo, type Plataforma } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as extrairVideoSemFalaIA from "@/ia/prompts/extrairVideoSemFala";
import { registrarGeracao } from "@/ia/registro";
import { config } from "@/lib/config";
import { DENTRO_DO_TETO_DE_DURACAO, incluirSeed, PERTENCE_AO_NICHO, reguaDoSetor } from "@/servicos/pesquisa";
import { temposDeQuadro } from "@/servicos/quadros";

import { midiaUrlFresca } from "./coleta-comum";
import { TAMANHO_MINIMO_TRANSCRICAO } from "./extracao-comum";
import { apagarVideo, baixarVideo480p, duracaoDoArquivoS, extrairQuadros } from "./video";
import { ehUrlDoYoutube, pausaEntreVideosYoutube } from "./youtube-cliente";

type CandidatoSemFala = {
  id: number;
  url: string;
  plataforma: Plataforma;
  midiaUrl: string | null;
  midiaUrlEm: Date | null;
  titulo: string | null;
  descricao: string | null;
  duracaoS: number | null;
};

const NOVENTA_DIAS_MS = 90 * 24 * 60 * 60 * 1000;
const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Item 0a da revisão dos PRs #74/#76: elegível só depois de a transcrição ter sido tentada, nunca
 * antes. `transcricao IS NULL` sozinho incluía o vídeo que só está esperando a vez na fila do
 * `transcrever` (teto e pausa); como a ordem dos dois jobs é por views, os dois competiam pelos
 * mesmos vídeos, e o `extrair-sem-fala` às vezes vencia a corrida com um vídeo que tinha fala de
 * verdade. Duas formas de "já tentou": a transcrição saiu curta demais (`transcricao` preenchida,
 * mas abaixo do mínimo) ou a tentativa falhou de verdade e `transcrever.ts`/`extrair-agora.ts` já
 * marcaram `proximaTentativaTranscricao`.
 */
function condicoesElegivelSemFala(nichoId: number, pisoViews: number) {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.views, pisoViews),
    // Item 0b: a mesma janela de 90 dias da evidência, e só vídeo que já foi pontuado
    // (`fora_da_curva` não nulo); sem isso a leitura mais cara do produto podia gastar o teto
    // diário num vídeo velho ou na média da própria conta, que nunca vira referência.
    gte(videos.publicadoEm, new Date(Date.now() - NOVENTA_DIAS_MS)),
    isNotNull(videos.foraDaCurva),
    isNull(videos.analise),
    or(
      and(isNotNull(videos.transcricao), sql`char_length(trim(${videos.transcricao})) < ${TAMANHO_MINIMO_TRANSCRICAO}`),
      isNotNull(videos.proximaTentativaTranscricao),
    ),
    // Item 0e: o vídeo que falhou no download ou na leitura por imagem some da consulta por 7
    // dias (`proximaTentativaSemFala`), para não ocupar vaga do teto diário em toda rodada.
    or(isNull(videos.proximaTentativaSemFala), lte(videos.proximaTentativaSemFala, new Date())),
    PERTENCE_AO_NICHO,
    DENTRO_DO_TETO_DE_DURACAO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));
  return condicoes;
}

async function candidatosDoNicho(nichoId: number, teto: number): Promise<CandidatoSemFala[]> {
  const regua = await reguaDoSetor(nichoId);
  if (!regua.videoSemFalaVale) return [];

  return db()
    .select({
      id: videos.id,
      url: videos.url,
      plataforma: videos.plataforma,
      midiaUrl: videos.midiaUrl,
      midiaUrlEm: videos.midiaUrlEm,
      titulo: videos.titulo,
      descricao: videos.descricao,
      duracaoS: videos.duracaoS,
    })
    .from(videos)
    .where(and(...condicoesElegivelSemFala(nichoId, regua.pisoViews)))
    .orderBy(sql`${videos.foraDaCurva} desc nulls last`, desc(videos.views), asc(videos.id))
    .limit(teto);
}

/** Mesmo raciocínio de `analisar-visual.ts`: endereço de mídia direto quando fresco. */
function urlParaBaixar(video: CandidatoSemFala): string {
  if (video.plataforma === "instagram" && video.midiaUrl && midiaUrlFresca(video.midiaUrlEm)) {
    return video.midiaUrl;
  }
  return video.url;
}

async function analisarUm(video: CandidatoSemFala, nomeNicho: string, termosNicho: string[]): Promise<void> {
  let caminhoVideo: string | null = null;
  try {
    caminhoVideo = await baixarVideo480p(urlParaBaixar(video), video.plataforma);

    const duracaoS = video.duracaoS ?? (await duracaoDoArquivoS(caminhoVideo));
    if (video.duracaoS === null) {
      await db().update(videos).set({ duracaoS }).where(eq(videos.id, video.id));
    }

    const quadros = await extrairQuadros(caminhoVideo, temposDeQuadro(duracaoS));

    const resultado = await gerarEstruturado({
      tarefa: "extrairVideoSemFala",
      nivel: extrairVideoSemFalaIA.nivel,
      effort: extrairVideoSemFalaIA.esforco,
      schema: extrairVideoSemFalaIA.schema,
      sistemaEstavel: extrairVideoSemFalaIA.montarSistemaEstavel(),
      entrada: extrairVideoSemFalaIA.montarEntrada({
        titulo: video.titulo ?? "",
        legenda: video.descricao ?? "",
        duracaoS,
        nomeNicho,
        termosNicho,
      }),
      imagens: quadros.map((quadro) => ({ base64: quadro.base64, mediaType: "image/jpeg" as const })),
    });

    const { etiquetas, ...analise } = resultado.dados;
    const analiseVideo: AnaliseVideo = analise;
    // M4, item 1: este é o caminho sem fala, por definição. Achado 5 da revisão do motor
    // (01/10/2026): tipoConteudo/serveDeModelo saem em colunas próprias também (mesmo caminho de
    // `aplicarResultadoExtracao`, que mantém os dois no jsonb `analise` e fora dele), para
    // `evidenciaParaRoteiro` filtrar por SQL.
    await db()
      .update(videos)
      .set({
        analise: analiseVideo,
        etiquetas,
        tipoConteudo: resultado.dados.tipoConteudo,
        serveDeModelo: resultado.dados.serveDeModelo,
        semFala: true,
      })
      .where(eq(videos.id, video.id));

    await registrarGeracao({
      tarefa: "extrairVideoSemFala",
      versaoPrompt: extrairVideoSemFalaIA.versao,
      modelo: resultado.modelo,
      nivel: extrairVideoSemFalaIA.nivel,
      entradas: { videoId: video.id },
      saida: resultado.dados,
      uso: {
        tokensEntrada: resultado.tokensEntrada,
        tokensSaida: resultado.tokensSaida,
        tokensCacheLeitura: resultado.tokensCacheLeitura,
        tokensCacheEscrita: resultado.tokensCacheEscrita,
      },
    });
  } finally {
    if (caminhoVideo) await apagarVideo(caminhoVideo);
  }
}

export async function rodarExtrairSemFala(nichoId?: number): Promise<Record<string, unknown>> {
  const condicoesNicho = [eq(nichos.ativo, true)];
  if (nichoId !== undefined) condicoesNicho.push(eq(nichos.id, nichoId));
  const nichosAtivos = await db()
    .select({ id: nichos.id, slug: nichos.slug, nome: nichos.nome, termos: nichos.termos })
    .from(nichos)
    .where(and(...condicoesNicho));

  let setoresComVideoSemFala = 0;
  let analisados = 0;
  let falhas = 0;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    const candidatos = await candidatosDoNicho(nicho.id, config.regras.analiseSemFalaPorDia);
    if (candidatos.length === 0) continue;
    setoresComVideoSemFala += 1;

    for (const video of candidatos) {
      try {
        await analisarUm(video, nicho.nome, nicho.termos);
        analisados += 1;
      } catch (erro) {
        falhas += 1;
        erros.push(`video ${video.id} / setor "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
        // Item 0e: falha de download ou de leitura some da consulta por 7 dias, para não travar o
        // teto diário com o mesmo vídeo (um link morto, por exemplo) em toda rodada.
        await db()
          .update(videos)
          .set({ proximaTentativaSemFala: new Date(Date.now() + SETE_DIAS_MS) })
          .where(eq(videos.id, video.id));
      }

      if (ehUrlDoYoutube(video.url)) await pausaEntreVideosYoutube();
    }
  }

  return {
    setores: nichosAtivos.length,
    setoresComVideoSemFala,
    analisados,
    falhas,
    erros: erros.length > 0 ? erros : undefined,
  };
}

export type EfeitoVideoSemFala = { elegiveis7Dias: number; elegiveis30Dias: number };

/**
 * M3, item 3: quantos vídeos do setor ficariam elegíveis para a leitura por imagem (views acima
 * do piso proposto, transcrição curta ou ausente, ainda sem análise) nos últimos 7 e 30 dias, se
 * "vídeo sem fala vale" for ligado com este piso. Não olha a coluna `nichos.video_sem_fala_vale`
 * atual: é sempre "o que aconteceria", não "o que já está acontecendo".
 */
export async function contagemElegivelSemFala(nichoId: number, pisoViews: number): Promise<EfeitoVideoSemFala> {
  const condicoes = (dias: number) => and(...condicoesElegivelSemFala(nichoId, pisoViews), gte(videos.publicadoEm, new Date(Date.now() - dias * 24 * 60 * 60 * 1000)));

  const [linha] = await db()
    .select({
      elegiveis7Dias: sql<number>`count(*) filter (where ${condicoes(7)})::int`,
      elegiveis30Dias: sql<number>`count(*) filter (where ${condicoes(30)})::int`,
    })
    .from(videos)
    .where(eq(videos.nichoId, nichoId));

  return { elegiveis7Dias: linha?.elegiveis7Dias ?? 0, elegiveis30Dias: linha?.elegiveis30Dias ?? 0 };
}
