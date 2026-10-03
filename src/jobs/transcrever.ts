/**
 * Job `transcrever` (etapa 8, diario, depois de `pontuar`): ler o que foi
 * dito nos videos que passaram no filtro (escopo 5.5, camada 2). Para
 * YouTube, tenta a legenda automatica primeiro (gratis); se nao tiver
 * legenda no idioma, ou para as outras plataformas, baixa o audio e
 * transcreve na Groq. Sem `GROQ_API_KEY`, so a legenda do YouTube roda
 * (`.env.example`); nenhum video de outra plataforma e sequer tentado, e
 * isso nao conta como falha (nao marca `proximaTentativaTranscricao`).
 *
 * Achado da conferencia de producao, 09/09/2026: o bloqueio do YouTube por
 * IP de datacenter ("Sign in to confirm you're not a bot") ganha uma nova
 * tentativa mais curta (3 dias, `TRES_DIAS_MS`) que a falha generica (7
 * dias), e conta a parte em `falhasYoutubeBot` no resumo, para a
 * conferencia ler sem abrir cada linha de erro.
 *
 * V2a, item 1 (força-tarefa da viagem, medido em produção em 19/09: 155 de
 * 12.293 vídeos com análise, 4 a 8 transcrições fechando o dia): o job
 * pegava uma lista fixa de até `transcricoesPorDia` candidatos e a
 * percorria uma vez, gastando a vaga em cada falha de download (18 a 22
 * por dia só no bloqueio do YouTube). `candidatosDoNicho` agora devolve
 * uma fila `FATOR_FILA` vezes maior, na mesma ordem de prioridade; o laço
 * consome a fila até fechar `transcricoesPorDia` sucessos de verdade ou a
 * fila acabar, e para de tentar uma plataforma inteira depois de
 * `MAX_FALHAS_SEGUIDAS_FREIO` falhas seguidas nela.
 *
 * V2a, item 3: vídeo do Instagram com `videos.midiaUrl` lida há menos de
 * 20h (`midiaUrlFresca`, `coleta-comum.ts`) baixa direto pelo endereço de
 * mídia da Meta, sem cair no yt-dlp contra a página do Instagram
 * (`urlParaBaixar`, em `candidatosDoNicho`); a pausa entre chamadas do
 * YouTube continua olhando a `url` de verdade, nunca `urlParaBaixar`.
 *
 * V2a, item 5 (corrigido no ajuste 1 da revisão do PR #45): os dois updates
 * de sucesso gravam `transcritoEm` junto com `transcricao`; é o sinal que
 * `resumoLeituraPorPlataforma` (`admin-coleta.ts`) usa para "lidos hoje" em
 * `/admin/nichos/[slug]`. Primeiro foi `atualizadoEm`, mas `upsertVideo`
 * grava essa coluna em toda recoleta, e a linha do admin acabava medindo a
 * coleta, não a leitura (77 "transcritos hoje" contra 8 de verdade).
 * `atualizadoEm` volta a ser só da coleta.
 *
 * M5c (hotfix, achado da madrugada de 03/10/2026: o job começou às 04:00 e ainda rodava às 07:00, com 45 vídeos da
 * Dr.Wash, 3 do Bruno e zero da Overtake; os do YouTube passam um a um pelo proxy, com pausa, e o `yt-dlp` não tinha
 * tempo limite; a fila vence o job às 4 h sem repetir, e a cadeia nunca disparava). Três coisas: (1) tempo limite por
 * vídeo no `yt-dlp` (áudio e legenda, `audio.ts` e `legendas-youtube.ts`, via `processo.ts`) e na Groq (`groq-api.ts`):
 * o processo morre, o vídeo conta como falha com nova tentativa em 3 dias, e o job segue para o próximo; (2) orçamento
 * de tempo por setor aqui dentro (`orcamentoTranscreverPorSetorMin`, 30 min): passou, o setor para e o que sobrou fica
 * para a noite seguinte (a fila é por vídeo ainda sem leitura), então um setor lento não deixa os outros a zero; o
 * orçamento de cada setor é também limitado por um teto do job inteiro dividido pelos setores que faltam
 * (`orcamentoTranscreverTotalMin`, 3h30, abaixo das 4 h da fila), então o job sempre termina; (3) a cadeia
 * `extrair-sem-fala` e `extrair` dispara no fim do job SEMPRE (num `finally`), parou pelo orçamento ou não.
 */
import { and, eq, inArray } from "drizzle-orm";

import { PRECO_GROQ_USD_POR_HORA } from "@/config/precos-ia";
import { db } from "@/db";
import { contas, nichos, videos, type Plataforma } from "@/db/schema";
import { apagarAudio, baixarAudio, ErroAudio, ErroAudioTempoLimite } from "@/jobs/audio";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { baixarLegendaYoutube, ErroLegendaTempoLimite } from "@/jobs/legendas-youtube";
import { ehUrlDoYoutube, pausaEntreVideosYoutube } from "@/jobs/youtube-cliente";
import { config } from "@/lib/config";
import { logger } from "@/lib/log";
import { foraDaCurvaDoNicho, subindoHoje } from "@/servicos/pesquisa";
import { contaEhBrasileira } from "@/servicos/proporcao-brasil";
import { MAX_POR_CONTA, selecionarParaTranscrever, type VideoParaSelecionar } from "@/servicos/selecionar-transcricao";

import { midiaUrlFresca } from "./coleta-comum";
import { ErroGroq, ErroGroqTempoLimite, transcreverAudio } from "./groq-api";

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Achado da conferência de produção, 09/09/2026: o YouTube bloqueia o
 * download com "Sign in to confirm you're not a bot" quando o servidor não
 * tem runtime de JavaScript nem cliente de player sem PO Token (corrigido
 * nesta rodada, `youtube-cliente.ts`); a mensagem continua podendo
 * aparecer (o bloqueio pode ter outra causa, ou voltar). Uma tentativa
 * nova em 3 dias, mais curta que os 7 dias genéricos, porque este caso
 * específico tem chance real de já estar resolvido nesse prazo.
 */
const TRES_DIAS_MS = 3 * 24 * 60 * 60 * 1000;
const MENSAGEM_BOT_YOUTUBE = /sign in to confirm you.{0,3}re not a bot/i;

/**
 * A fila fica maior que o teto diário (V2a, item 1: "vaga perdida não
 * conta"). Antes, `candidatosDoNicho` já devolvia no máximo `limite`
 * vídeos, e cada falha de download gastava uma vaga sem substituto; o job
 * fechava o dia com bem menos que `transcricoesPorDia` transcrições de
 * verdade. Com 4 vezes o teto na mesma ordem de prioridade, sobra fila
 * para `rodarTranscrever` continuar puxando candidato depois de uma falha,
 * até fechar o teto em sucessos ou a fila acabar.
 */
const FATOR_FILA = 4;

/**
 * Desempate por mídia fresca (V2a, item 3): entre dois vídeos de mesma
 * prioridade (mesmo `score`), o do Instagram com `midiaUrl` fresca vem
 * primeiro, porque baixa direto pelo endereço de mídia, sem yt-dlp contra
 * a página. A ordem entre scores diferentes nunca muda; só o desempate.
 */
function comMidiaFrescaComoDesempate<T extends { id: number }>(
  lista: T[],
  score: (item: T) => number | null,
  idsComMidiaFresca: Set<number>,
): T[] {
  return [...lista].sort((a, b) => {
    const scoreA = score(a) ?? Number.NEGATIVE_INFINITY;
    const scoreB = score(b) ?? Number.NEGATIVE_INFINITY;
    if (scoreA !== scoreB) return scoreB - scoreA;

    const frescaA = idsComMidiaFresca.has(a.id) ? 0 : 1;
    const frescaB = idsComMidiaFresca.has(b.id) ? 0 : 1;
    if (frescaA !== frescaB) return frescaA - frescaB;

    return a.id - b.id;
  });
}

async function candidatosDoNicho(nichoId: number, tetoDiario: number) {
  const tamanhoFila = tetoDiario * FATOR_FILA;
  // V2b, item 10: o teto por conta entra aqui, na consulta, antes do LIMIT
  // (`maxPorConta`), não só depois em `limitarPorConta`; sem isso, quando as
  // notas mais altas se concentram em poucas contas, o corte por tamanho da
  // consulta já esgota a fila com poucas contas repetidas, e `limitarPorConta`
  // encolhe o que sobrou para bem menos que `tetoDiario` (achado da prova em
  // produção, 19/09 à noite: 187 vídeos fora da curva do Instagram, com mídia
  // fresca, nunca chegavam a ser tentados).
  // Achado 1 da revisão do motor (01/10/2026): o último `true` exclui, antes desse mesmo teto por
  // conta, o vídeo que já tem transcrição, análise ou tentativa futura marcada; sem isso, as duas
  // vagas de uma conta podiam ir inteiras para vídeo que `selecionarParaTranscrever` já descartava,
  // e a conta nunca oferecia um 3º vídeo livre.
  const [prioritarios, estruturais] = await Promise.all([
    subindoHoje(nichoId, tamanhoFila, MAX_POR_CONTA, true),
    foraDaCurvaDoNicho(nichoId, 90, tamanhoFila, MAX_POR_CONTA, true),
  ]);

  const idsUnicos = [...new Set([...prioritarios.map((v) => v.id), ...estruturais.map((v) => v.id)])];
  if (idsUnicos.length === 0) {
    return {
      selecionados: [] as number[],
      porId: new Map<number, { url: string; urlParaBaixar: string; plataforma: Plataforma; duracaoS: number | null; idioma: string | null }>(),
    };
  }

  const linhas = await db()
    .select({
      id: videos.id,
      contaId: videos.contaId,
      url: videos.url,
      plataforma: videos.plataforma,
      duracaoS: videos.duracaoS,
      transcricao: videos.transcricao,
      proximaTentativaTranscricao: videos.proximaTentativaTranscricao,
      midiaUrl: videos.midiaUrl,
      midiaUrlEm: videos.midiaUrlEm,
      idioma: videos.idioma,
      contaPais: contas.pais,
      contaIdiomaPrincipal: contas.idiomaPrincipal,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(inArray(videos.id, idsUnicos));

  const candidatos: VideoParaSelecionar[] = linhas.map((l) => ({
    id: l.id,
    contaId: l.contaId,
    temTranscricao: Boolean(l.transcricao),
    proximaTentativaTranscricao: l.proximaTentativaTranscricao,
    idioma: l.idioma,
    contaBrasileira: contaEhBrasileira(l.contaPais, l.contaIdiomaPrincipal),
  }));

  const agora = new Date();
  const idsComMidiaFresca = new Set(
    linhas.filter((l) => l.plataforma === "instagram" && l.midiaUrl && midiaUrlFresca(l.midiaUrlEm, agora)).map((l) => l.id),
  );

  const selecionados = selecionarParaTranscrever(
    comMidiaFrescaComoDesempate(prioritarios, (v) => v.velocidadeRelativa, idsComMidiaFresca).map((v) => v.id),
    comMidiaFrescaComoDesempate(estruturais, (v) => v.foraDaCurva, idsComMidiaFresca).map((v) => v.id),
    candidatos,
    tamanhoFila,
    agora,
  );

  const porId = new Map(
    linhas.map((l) => [
      l.id,
      {
        url: l.url,
        urlParaBaixar: idsComMidiaFresca.has(l.id) ? l.midiaUrl! : l.url,
        plataforma: l.plataforma,
        duracaoS: l.duracaoS,
        idioma: l.idioma,
      },
    ]),
  );
  return { selecionados, porId };
}

type ResultadoVideo =
  | { tipo: "legenda" }
  | { tipo: "pulado" }
  | { tipo: "groq"; duracaoS: number | null }
  | { tipo: "falhou"; motivo: string }
  | { tipo: "falhouYoutubeBot"; motivo: string }
  /** O `yt-dlp` ou a Groq passou do tempo limite por vídeo e foi encerrado (M5c). */
  | { tipo: "falhouTempoLimite"; motivo: string };

/**
 * Legenda automatica curta demais ("E ai", ou uma legenda confusa que virou
 * poucas palavras depois de interpretarVtt) nao carrega informacao o
 * bastante; tratada como "sem legenda" e cai para audio mais Groq (achado
 * da revisao da etapa 8, calibrar depois com mais exemplos reais).
 */
const TAMANHO_MINIMO_LEGENDA = 200;

/** "outro" e nulo (nao sei, alfabeto nao latino): so os tres que a Groq e o YouTube sabem buscar/forcar de verdade. */
function idiomaParaForcar(idioma: string | null): "pt" | "en" | "es" | undefined {
  return idioma === "pt" || idioma === "en" || idioma === "es" ? idioma : undefined;
}

async function transcreverUm(
  videoId: number,
  url: string,
  plataforma: Plataforma,
  duracaoS: number | null,
  idiomaConhecido: string | null,
): Promise<ResultadoVideo> {
  const idiomaParaBuscar = idiomaParaForcar(idiomaConhecido);

  // Achado 3 da revisao do motor (01/10/2026): so pede legenda do YouTube quando ja sabe o
  // idioma do video (`videos.idioma`, da coleta); sem isso, "--sub-lang" forcado buscava a
  // traducao automatica do YouTube para quem nao sabia, nunca a fala original.
  if (plataforma === "youtube" && idiomaParaBuscar) {
    let legenda: string | null;
    try {
      legenda = await baixarLegendaYoutube(url, idiomaParaBuscar);
    } catch (erro) {
      // O `yt-dlp` pendurou na legenda (proxy engasgado): o áudio penduraria pelo mesmo motivo, então o vídeo fica para daqui a
      // alguns dias em vez de gastar o limite uma segunda vez neste mesmo vídeo.
      if (erro instanceof ErroLegendaTempoLimite) {
        await db()
          .update(videos)
          .set({ proximaTentativaTranscricao: new Date(Date.now() + TRES_DIAS_MS), falhaDeInfraEm: new Date() })
          .where(eq(videos.id, videoId));
        return { tipo: "falhouTempoLimite", motivo: erro.message };
      }
      throw erro;
    }
    if (legenda && legenda.length >= TAMANHO_MINIMO_LEGENDA) {
      await db()
        .update(videos)
        .set({ transcricao: legenda, transcritoEm: new Date(), idiomaConfirmado: true, falhaDeInfraEm: null })
        .where(eq(videos.id, videoId));
      return { tipo: "legenda" };
    }
  }

  if (!config.transcricao.groqKey) {
    return { tipo: "pulado" };
  }

  let caminhoAudio: string | null = null;
  try {
    caminhoAudio = await baixarAudio(url, plataforma);
    const { texto, idiomaDetectado, semFala } = await transcreverAudio(caminhoAudio, idiomaParaBuscar);

    // Achado 13 da revisão do motor (01/10/2026): vazia sem a Groq confirmar ausência de fala
    // (no_speech_prob baixo) é tratada como falha de verdade, com nova tentativa em 7 dias; sem
    // isto, `transcricao` virava uma string vazia permanente (nunca mais null), e a elegibilidade
    // de `pesquisa.ts` (achado 1, `isNull(videos.transcricao)`) nunca mais oferecia o vídeo de
    // novo, mesmo com a data de nova tentativa já vencida.
    if (!semFala && !texto.trim()) {
      await db()
        .update(videos)
        .set({ proximaTentativaTranscricao: new Date(Date.now() + SETE_DIAS_MS), falhaDeInfraEm: null })
        .where(eq(videos.id, videoId));
      return { tipo: "falhou", motivo: "transcricao da Groq veio vazia, sem confirmar ausencia de fala" };
    }

    // Achado 3: `semFala` já deixa `texto` vazio, o suficiente para `extracao-comum.ts` mandar o
    // vídeo para o caminho sem fala; sem fala de verdade não há sinal de idioma confiável (achado
    // rodando contra a API de verdade: silêncio puro também "detecta" um idioma qualquer), então
    // não grava `idioma` nem `idiomaConfirmado` nesse caso. Com fala, o idioma que a Groq detectou
    // só substitui o que já estava em `videos.idioma` quando esse ainda não era confiável (nulo ou
    // "outro"); quando já era pt/en/es conhecido, mantém o valor e só confirma.
    await db()
      .update(videos)
      .set({
        transcricao: texto,
        transcritoEm: new Date(),
        falhaDeInfraEm: null,
        ...(semFala
          ? {}
          : idiomaParaBuscar
            ? { idiomaConfirmado: true }
            : idiomaDetectado && idiomaDetectado !== "outro"
              ? { idioma: idiomaDetectado, idiomaConfirmado: true }
              : {}),
      })
      .where(eq(videos.id, videoId));
    return { tipo: "groq", duracaoS };
  } catch (erro) {
    // O tempo limite vem antes do resto (`ErroAudioTempoLimite` e `ErroGroqTempoLimite` herdam dos erros comuns): tempo
    // perdido, falha transitória, nova tentativa em 3 dias, e contada à parte.
    if (erro instanceof ErroAudioTempoLimite || erro instanceof ErroGroqTempoLimite) {
      await db()
        .update(videos)
        .set({ proximaTentativaTranscricao: new Date(Date.now() + TRES_DIAS_MS), falhaDeInfraEm: new Date() })
        .where(eq(videos.id, videoId));
      return { tipo: "falhouTempoLimite", motivo: erro.message };
    }
    if (erro instanceof ErroAudio || erro instanceof ErroGroq) {
      const ehBotDoYoutube = plataforma === "youtube" && MENSAGEM_BOT_YOUTUBE.test(erro.message);
      await db()
        .update(videos)
        .set({
          proximaTentativaTranscricao: new Date(Date.now() + (ehBotDoYoutube ? TRES_DIAS_MS : SETE_DIAS_MS)),
          // O bloqueio do robô é falha de infraestrutura como o tempo limite (item 0 da E45), e a Groq que falha (limite de uso, 5xx,
          // conexão) também: o áudio baixou, o vídeo não tem nada de errado (achado da revisão independente). A falha comum de download
          // (link morto, vídeo privado) não: apaga a marca.
          falhaDeInfraEm: ehBotDoYoutube || erro instanceof ErroGroq ? new Date() : null,
        })
        .where(eq(videos.id, videoId));
      return ehBotDoYoutube
        ? { tipo: "falhouYoutubeBot", motivo: erro.message }
        : { tipo: "falhou", motivo: erro.message };
    }
    throw erro;
  } finally {
    if (caminhoAudio) await apagarAudio(caminhoAudio);
  }
}

/**
 * Freio por plataforma (V2a, item 1): depois de `MAX_FALHAS_SEGUIDAS_FREIO`
 * falhas seguidas, o job para de tentar aquela plataforma naquele nicho
 * naquela rodada, e segue só com as outras. Cada nicho começa com o
 * contador zerado; um sucesso na plataforma zera de novo. Para o YouTube,
 * só a falha com a mensagem do bot conta (é o padrão específico que
 * motivou o freio); para o TikTok, qualquer falha conta.
 */
const MAX_FALHAS_SEGUIDAS_FREIO = 10;

/**
 * O relógio e os orçamentos do `rodarTranscrever` (M5c). Só o teste passa algo aqui; o job de verdade usa `Date.now` e os
 * dois números de `config.regras`.
 */
export type OpcoesTranscrever = {
  agora?: () => number;
  orcamentoPorSetorMs?: number;
  orcamentoTotalMs?: number;
};

/** Os dois orçamentos do job em milissegundos, a partir da configuração (que vem em minutos). A conversão fica aqui, e não solta no job, para o teste conferir a escala. */
export function orcamentosDaConfig(): { porSetorMs: number; totalMs: number } {
  return {
    porSetorMs: config.regras.orcamentoTranscreverPorSetorMin * 60_000,
    totalMs: config.regras.orcamentoTranscreverTotalMin * 60_000,
  };
}

/**
 * O orçamento de tempo de um setor (M5c): o menor entre o por setor e o que sobra do teto do job dividido pelos setores que ainda
 * faltam (o atual inclusive). Pura, para testar sem relógio: com 6 setores, 30 min cada e teto de 3h30, nenhum setor perde a vez
 * porque os de antes gastaram o que era dele, e a soma nunca passa do teto.
 */
export function orcamentoDoSetor(porSetorMs: number, totalMs: number, decorridoMs: number, setoresQueFaltam: number): number {
  const restante = Math.max(0, totalMs - decorridoMs);
  return Math.min(porSetorMs, Math.floor(restante / Math.max(1, setoresQueFaltam)));
}

/**
 * M2, item 0a2 da revisão do PR #73: com `nichoId`, só aquele setor, sem esperar o `for` percorrer
 * todo o resto dos nichos ativos antes de chegar nele (a "cadeia de verdade" da primeira carga,
 * item 4: o teto diário já é por nicho dentro do laço, nunca compartilhado entre eles; o que faltava
 * era poder pular direto para um setor só). Sem `nichoId`, o comportamento de sempre.
 */
export async function rodarTranscrever(nichoId?: number, opcoes: OpcoesTranscrever = {}): Promise<Record<string, unknown>> {
  const agora = opcoes.agora ?? Date.now;
  const daConfig = orcamentosDaConfig();
  const porSetorMs = opcoes.orcamentoPorSetorMs ?? daConfig.porSetorMs;
  const totalMs = opcoes.orcamentoTotalMs ?? daConfig.totalMs;
  const inicioDoJob = agora();

  const condicoes = [eq(nichos.ativo, true)];
  if (nichoId !== undefined) condicoes.push(eq(nichos.id, nichoId));
  // Ordem fixa por id: a mesma de sempre, sem depender da ordem em que o banco devolve as linhas.
  const nichosAtivos = await db().select().from(nichos).where(and(...condicoes)).orderBy(nichos.id);

  let porLegenda = 0;
  let porGroq = 0;
  let pulados = 0;
  let falhas = 0;
  /** Falhas com a mensagem do bot do YouTube, contadas à parte (também somam em `falhas`), para a conferência ler de longe. */
  let falhasYoutubeBot = 0;
  /** Falhas por tempo limite (`yt-dlp` ou Groq encerrados), contadas à parte (também somam em `falhas`). */
  let falhasPorTempoLimite = 0;
  let segundosAudioGroq = 0;
  const erros: string[] = [];

  const tentativas: Record<string, number> = { youtube: 0, tiktok: 0, instagram: 0 };
  const sucessos: Record<string, number> = { youtube: 0, tiktok: 0, instagram: 0 };
  let youtubePausado = false;
  let tiktokPausado = false;
  /** Os setores que pararam pelo orçamento de tempo, com quantos vídeos da fila ficaram para a noite seguinte. */
  const setoresParadosPeloOrcamento: { slug: string; ficaramParaDepois: number }[] = [];
  /** Quanto cada setor levou, em segundos (para calibrar o orçamento olhando o resumo, sem abrir log). */
  const segundosPorSetor: Record<string, number> = {};

  try {
    for (const [indiceDoSetor, nicho] of nichosAtivos.entries()) {
      const inicioDoSetor = agora();
      const orcamentoMs = orcamentoDoSetor(porSetorMs, totalMs, inicioDoSetor - inicioDoJob, nichosAtivos.length - indiceDoSetor);
      const tetoDiario = config.regras.transcricoesPorDia;
      const { selecionados, porId } = await candidatosDoNicho(nicho.id, tetoDiario);

      let sucessosNoNicho = 0;
      let falhasSeguidasBotYoutube = 0;
      let falhasSeguidasTiktok = 0;
      let youtubePausadoNoNicho = false;
      let tiktokPausadoNoNicho = false;

      for (const [indiceDoVideo, videoId] of selecionados.entries()) {
        if (sucessosNoNicho >= tetoDiario) break;

        // O orçamento do setor acabou: o que sobrou da fila fica para a noite seguinte (a fila é por vídeo ainda sem leitura, então
        // o vídeo não tentado volta sozinho), e o job segue para o próximo setor. Confere antes de cada vídeo, nunca no meio de um:
        // um vídeo em andamento ainda pode passar do orçamento pelo seu próprio pior caso (legenda, áudio e Groq, cada um com o seu limite).
        if (agora() - inicioDoSetor >= orcamentoMs) {
          setoresParadosPeloOrcamento.push({
            slug: nicho.slug,
            ficaramParaDepois: selecionados.slice(indiceDoVideo).filter((id) => porId.has(id)).length,
          });
          break;
        }

        const info = porId.get(videoId);
        if (!info) continue;
        if (info.plataforma === "youtube" && youtubePausadoNoNicho) continue;
        if (info.plataforma === "tiktok" && tiktokPausadoNoNicho) continue;

        tentativas[info.plataforma] = (tentativas[info.plataforma] ?? 0) + 1;

        try {
          const resultado = await transcreverUm(videoId, info.urlParaBaixar, info.plataforma, info.duracaoS, info.idioma);
          if (resultado.tipo === "legenda" || resultado.tipo === "groq") {
            sucessos[info.plataforma] = (sucessos[info.plataforma] ?? 0) + 1;
            sucessosNoNicho += 1;
            if (info.plataforma === "youtube") falhasSeguidasBotYoutube = 0;
            if (info.plataforma === "tiktok") falhasSeguidasTiktok = 0;

            if (resultado.tipo === "legenda") porLegenda += 1;
            else {
              porGroq += 1;
              segundosAudioGroq += resultado.duracaoS ?? 0;
            }
          } else if (resultado.tipo === "pulado") {
            pulados += 1;
          } else if (resultado.tipo === "falhou") {
            falhas += 1;
            erros.push(`video ${videoId} / nicho "${nicho.slug}": ${resultado.motivo}`);
            if (info.plataforma === "tiktok") {
              falhasSeguidasTiktok += 1;
              if (falhasSeguidasTiktok >= MAX_FALHAS_SEGUIDAS_FREIO) tiktokPausadoNoNicho = true;
            }
          } else if (resultado.tipo === "falhouYoutubeBot") {
            falhas += 1;
            falhasYoutubeBot += 1;
            erros.push(`video ${videoId} / nicho "${nicho.slug}": ${resultado.motivo}`);
            falhasSeguidasBotYoutube += 1;
            if (falhasSeguidasBotYoutube >= MAX_FALHAS_SEGUIDAS_FREIO) youtubePausadoNoNicho = true;
          } else if (resultado.tipo === "falhouTempoLimite") {
            falhas += 1;
            falhasPorTempoLimite += 1;
            erros.push(`video ${videoId} / nicho "${nicho.slug}": ${resultado.motivo}`);
            // Dez vídeos seguidos pendurados na mesma plataforma é o proxy (ou o próprio YouTube) fora do ar: o mesmo freio do bloqueio.
            if (info.plataforma === "youtube") {
              falhasSeguidasBotYoutube += 1;
              if (falhasSeguidasBotYoutube >= MAX_FALHAS_SEGUIDAS_FREIO) youtubePausadoNoNicho = true;
            }
            if (info.plataforma === "tiktok") {
              falhasSeguidasTiktok += 1;
              if (falhasSeguidasTiktok >= MAX_FALHAS_SEGUIDAS_FREIO) tiktokPausadoNoNicho = true;
            }
          }
        } catch (erro) {
          falhas += 1;
          erros.push(`video ${videoId} / nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
        }

        // Espaça as chamadas ao YouTube (item 2 desta rodada), depois de
        // processar o vídeo (qualquer resultado), antes do próximo. Olha a
        // `url` da página (nunca `urlParaBaixar`): é ela que diz se o yt-dlp
        // falou com o YouTube, e o endereço direto de mídia da Meta nunca é.
        // O download em si decide por plataforma (`argumentosPorPlataforma`,
        // `audio.ts` e `video.ts`), não por host; `ehUrlDoYoutube` ficou só
        // para esta pausa.
        if (ehUrlDoYoutube(info.url)) await pausaEntreVideosYoutube();
      }

      if (youtubePausadoNoNicho) youtubePausado = true;
      if (tiktokPausadoNoNicho) tiktokPausado = true;
      segundosPorSetor[nicho.slug] = Math.round((agora() - inicioDoSetor) / 1000);
    }
  } finally {
    /**
     * M5b, item 1: a ordem dos jobs da madrugada, encadeada (achado da conferência de 02/10, com a
     * fila destravada pela M5a: o `transcrever` levou 1h33 e passou por cima do `extrair-sem-fala`
     * das 04:40 e do `extrair` das 05:00, que só acharam o que já estava transcrito antes deles
     * começarem). Só a rodada global (sem `nichoId`, o cron das 04:00) encadeia; a "primeira carga"
     * de `pesquisa-de-setor.ts` (que passa `nichoId`) já tem a própria cadeia síncrona, passo a
     * passo, e não deve disparar `extrair-sem-fala`/`extrair` para todos os setores por causa de um
     * setor só. Os horários fixos de `agenda.ts` continuam como reserva (se o worker cair no meio da
     * cadeia, por exemplo); não duplicam trabalho porque `extrair-sem-fala` e `extrair` só
     * selecionam vídeo sem `analise` (conferido: `condicoesElegivelSemFala`, `isNull(videos.analise)`
     * em extrair.ts), então uma segunda rodada sobre o mesmo vídeo não acha nada para processar de
     * novo. A fila nunca derruba a transcrição (mesma regra de `extrair-coleta.ts`): se o pg-boss
     * estiver fora do ar, o erro fica só no log.
     *
     * M5c: dispara SEMPRE que a rodada global termina, num `finally`: parou pelo orçamento de tempo, acabou
     * a fila, ou um erro inesperado interrompeu o laço (antes, o job que passava das 4 h nunca chegava aqui,
     * e o que já estava transcrito ficava sem análise até a noite seguinte).
     */
    if (nichoId === undefined) {
      try {
        await garantirBossPronto();
        await boss().send(FILAS.extrairSemFala, {});
      } catch (erro) {
        logger.error({ err: erro }, "nao foi possivel enfileirar extrair-sem-fala depois da transcricao");
      }
    }
  }

  return {
    nichos: nichosAtivos.length,
    transcritosPorLegenda: porLegenda,
    transcritosPorGroq: porGroq,
    puladosSemChaveGroq: pulados,
    falhas,
    falhasYoutubeBot,
    falhasPorTempoLimite,
    segundosAudioGroq,
    custoEstimadoGroqUsd: Number(((segundosAudioGroq / 3600) * PRECO_GROQ_USD_POR_HORA).toFixed(4)),
    tentativas,
    sucessos,
    youtubePausado,
    tiktokPausado,
    segundosPorSetor,
    setoresParadosPeloOrcamento: setoresParadosPeloOrcamento.length > 0 ? setoresParadosPeloOrcamento : undefined,
    erros: erros.length > 0 ? erros : undefined,
  };
}
