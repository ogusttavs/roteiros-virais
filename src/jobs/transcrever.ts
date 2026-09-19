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
 */
import { eq, inArray } from "drizzle-orm";

import { PRECO_GROQ_USD_POR_HORA } from "@/config/precos-ia";
import { db } from "@/db";
import { nichos, videos } from "@/db/schema";
import { apagarAudio, baixarAudio, ErroAudio } from "@/jobs/audio";
import { baixarLegendaYoutube } from "@/jobs/legendas-youtube";
import { ehUrlDoYoutube, pausaEntreVideosYoutube } from "@/jobs/youtube-cliente";
import { config } from "@/lib/config";
import { foraDaCurvaDoNicho, subindoHoje } from "@/servicos/pesquisa";
import { selecionarParaTranscrever, type VideoParaSelecionar } from "@/servicos/selecionar-transcricao";

import { midiaUrlFresca } from "./coleta-comum";
import { ErroGroq, transcreverAudio } from "./groq-api";

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
  const [prioritarios, estruturais] = await Promise.all([
    subindoHoje(nichoId, tamanhoFila),
    foraDaCurvaDoNicho(nichoId, 90, tamanhoFila),
  ]);

  const idsUnicos = [...new Set([...prioritarios.map((v) => v.id), ...estruturais.map((v) => v.id)])];
  if (idsUnicos.length === 0) {
    return {
      selecionados: [] as number[],
      porId: new Map<number, { url: string; urlParaBaixar: string; plataforma: string; duracaoS: number | null }>(),
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
    })
    .from(videos)
    .where(inArray(videos.id, idsUnicos));

  const candidatos: VideoParaSelecionar[] = linhas.map((l) => ({
    id: l.id,
    contaId: l.contaId,
    temTranscricao: Boolean(l.transcricao),
    proximaTentativaTranscricao: l.proximaTentativaTranscricao,
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
  | { tipo: "falhouYoutubeBot"; motivo: string };

/**
 * Legenda automatica curta demais ("E ai", ou uma legenda confusa que virou
 * poucas palavras depois de interpretarVtt) nao carrega informacao o
 * bastante; tratada como "sem legenda" e cai para audio mais Groq (achado
 * da revisao da etapa 8, calibrar depois com mais exemplos reais).
 */
const TAMANHO_MINIMO_LEGENDA = 200;

async function transcreverUm(
  videoId: number,
  url: string,
  plataforma: string,
  duracaoS: number | null,
): Promise<ResultadoVideo> {
  if (plataforma === "youtube") {
    const legenda = await baixarLegendaYoutube(url);
    if (legenda && legenda.length >= TAMANHO_MINIMO_LEGENDA) {
      await db().update(videos).set({ transcricao: legenda, transcritoEm: new Date() }).where(eq(videos.id, videoId));
      return { tipo: "legenda" };
    }
  }

  if (!config.transcricao.groqKey) {
    return { tipo: "pulado" };
  }

  let caminhoAudio: string | null = null;
  try {
    caminhoAudio = await baixarAudio(url);
    const texto = await transcreverAudio(caminhoAudio);
    await db().update(videos).set({ transcricao: texto, transcritoEm: new Date() }).where(eq(videos.id, videoId));
    return { tipo: "groq", duracaoS };
  } catch (erro) {
    if (erro instanceof ErroAudio || erro instanceof ErroGroq) {
      const ehBotDoYoutube = plataforma === "youtube" && MENSAGEM_BOT_YOUTUBE.test(erro.message);
      await db()
        .update(videos)
        .set({
          proximaTentativaTranscricao: new Date(Date.now() + (ehBotDoYoutube ? TRES_DIAS_MS : SETE_DIAS_MS)),
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

export async function rodarTranscrever(): Promise<Record<string, unknown>> {
  const nichosAtivos = await db().select().from(nichos).where(eq(nichos.ativo, true));

  let porLegenda = 0;
  let porGroq = 0;
  let pulados = 0;
  let falhas = 0;
  /** Falhas com a mensagem do bot do YouTube, contadas à parte (também somam em `falhas`), para a conferência ler de longe. */
  let falhasYoutubeBot = 0;
  let segundosAudioGroq = 0;
  const erros: string[] = [];

  const tentativas: Record<string, number> = { youtube: 0, tiktok: 0, instagram: 0 };
  const sucessos: Record<string, number> = { youtube: 0, tiktok: 0, instagram: 0 };
  let youtubePausado = false;
  let tiktokPausado = false;

  for (const nicho of nichosAtivos) {
    const tetoDiario = config.regras.transcricoesPorDia;
    const { selecionados, porId } = await candidatosDoNicho(nicho.id, tetoDiario);

    let sucessosNoNicho = 0;
    let falhasSeguidasBotYoutube = 0;
    let falhasSeguidasTiktok = 0;
    let youtubePausadoNoNicho = false;
    let tiktokPausadoNoNicho = false;

    for (const videoId of selecionados) {
      if (sucessosNoNicho >= tetoDiario) break;

      const info = porId.get(videoId);
      if (!info) continue;
      if (info.plataforma === "youtube" && youtubePausadoNoNicho) continue;
      if (info.plataforma === "tiktok" && tiktokPausadoNoNicho) continue;

      tentativas[info.plataforma] = (tentativas[info.plataforma] ?? 0) + 1;

      try {
        const resultado = await transcreverUm(videoId, info.urlParaBaixar, info.plataforma, info.duracaoS);
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
        }
      } catch (erro) {
        falhas += 1;
        erros.push(`video ${videoId} / nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
      }

      // Espaça as chamadas ao YouTube (item 2 desta rodada), depois de
      // processar o vídeo (qualquer resultado), antes do próximo. Pela URL
      // de verdade, não por `plataforma` (mesmo raciocínio de `video.ts`/
      // `audio.ts`, `ehUrlDoYoutube`): é a URL que decide se o yt-dlp
      // chamou o YouTube, não o rótulo da coluna.
      if (ehUrlDoYoutube(info.url)) await pausaEntreVideosYoutube();
    }

    if (youtubePausadoNoNicho) youtubePausado = true;
    if (tiktokPausadoNoNicho) tiktokPausado = true;
  }

  return {
    nichos: nichosAtivos.length,
    transcritosPorLegenda: porLegenda,
    transcritosPorGroq: porGroq,
    puladosSemChaveGroq: pulados,
    falhas,
    falhasYoutubeBot,
    segundosAudioGroq,
    custoEstimadoGroqUsd: Number(((segundosAudioGroq / 3600) * PRECO_GROQ_USD_POR_HORA).toFixed(4)),
    tentativas,
    sucessos,
    youtubePausado,
    tiktokPausado,
    erros: erros.length > 0 ? erros : undefined,
  };
}
