/**
 * Audio de um video, via yt-dlp mais ffmpeg (etapa 8): so audio, 64 kbps,
 * para as plataformas sem legenda oficial (TikTok, Instagram) e como
 * reforco quando o YouTube nao tem legenda no idioma pedido. yt-dlp baixa
 * de qualquer uma das tres plataformas com a mesma chamada.
 */
import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Plataforma } from "@/db/schema";
import { config } from "@/lib/config";

import { apagarSobrasDoDownload, type ExecutorDeProcesso, ErroTempoLimite, executarComLimite } from "./processo";
import { argumentosPorPlataforma, ErroDoProxy, motivoDaFalhaDoProxy } from "./youtube-cliente";

export class ErroAudio extends Error {}

/**
 * O `yt-dlp` passou do tempo limite por vídeo (M5c) e foi morto. É uma falha de verdade do vídeo (conta, nova tentativa em
 * alguns dias), mas de outra natureza que o bloqueio ou o arquivo ruim: quem chama a conta à parte.
 */
export class ErroAudioTempoLimite extends ErroAudio {}

/**
 * O proxy recusou o download (sem tráfego) ou não conectou (hotfix do proxy, 09/10/2026). Herda de `ErroDoProxy` para o `transcrever` tratar áudio e legenda do mesmo jeito, e de
 * `ErroAudio` não: um vídeo que não baixou por culpa do proxy nunca vira "falha do vídeo" (nada de nova tentativa em 3 ou 7 dias).
 */
export class ErroAudioDoProxy extends ErroDoProxy {}

/**
 * Hotfix do proxy (09/10/2026): o proxy se paga por gigabyte, e o `yt-dlp -x` sem `-f` baixava o áudio na melhor qualidade (uns 3,8 MB por vídeo) para só depois converter para
 * 64 kbps: 1.301 áudios em 12 dias esgotaram o pacote de 5 GB. No YouTube, que tem faixa só de áudio, pede-se a mais leve que serve (até 64 kbps, e na falta dela a pior
 * faixa só de áudio, e na falta de faixa só de áudio a pior que tenha áudio): a Groq transcreve bem a esse peso. TikTok e Instagram só têm faixa com vídeo, e um seletor
 * só de áudio recusaria o download inteiro ("Requested format is not available"): ficam como estavam.
 */
export const FORMATO_DE_AUDIO_LEVE_YOUTUBE = "ba[abr<=64]/wa/wa*";

/** O teto de tamanho do que o `yt-dlp` baixa por proxy: um vídeo longo (uma hora a 64 kbps já passa dos 25 MB) não engole o pacote do mês. */
export const TAMANHO_MAXIMO_DO_DOWNLOAD = "25M";

/**
 * Os argumentos do yt-dlp para baixar so o audio. Pura, para testar sem
 * abrir processo (mesmo padrao de `argumentosDeVideo480p` em `video.ts`).
 */
export function argumentosDeAudio(url: string, plataforma: Plataforma, modeloDeSaida: string): string[] {
  return [
    ...(plataforma === "youtube" ? ["-f", FORMATO_DE_AUDIO_LEVE_YOUTUBE] : []),
    ...(plataforma === "instagram" ? [] : ["--max-filesize", TAMANHO_MAXIMO_DO_DOWNLOAD]),
    "-x",
    "--audio-format",
    "mp3",
    "--postprocessor-args",
    "ffmpeg:-b:a 64k",
    // So o YouTube precisa do cliente sem PO Token, e o proxy (item 0 da preparacao da viagem)
    // vale para YouTube e TikTok, nunca Instagram: `argumentosPorPlataforma` decide.
    ...argumentosPorPlataforma(plataforma),
    "-o",
    modeloDeSaida,
    url,
  ];
}

/**
 * Tira segredo de uma mensagem de erro antes de ela ir para o banco
 * (`execucoes_job.resumo` e `.erro`, lidos no admin) ou para o log: o erro
 * do `execFile` repete a linha de comando inteira do `yt-dlp`, e nela vai
 * `--proxy http://usuario:senha@host:porta` (achado do Fable em 28/09/2026
 * conferindo produção; os registros antigos foram redigidos à mão no banco
 * e a senha do proxy foi trocada). Cobre o argumento `--proxy` e qualquer
 * url com credencial, em qualquer texto.
 */
export function ocultarSegredos(texto: string): string {
  return texto
    .replace(/--proxy\s+\S+/g, "--proxy [oculto]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, "$1[oculto]@");
}

/**
 * Baixa so o audio em mp3 a 64 kbps; devolve o caminho do arquivo
 * temporario. `plataforma` e obrigatoria (ajuste 2 da revisao do PR #45,
 * V2a): a url direta de midia da Meta, que `transcrever` e `meta-hashtags`
 * passam, nao tem cara de Instagram pelo host, e o palpite antigo por host
 * mandava esse download pelo proxy (que se paga por gigabyte).
 */
export async function baixarAudio(
  url: string,
  plataforma: Plataforma,
  /** Só para o teste: o limite e o processo. Sem isto, `config.transcricao.ytdlpLimiteS` e o `yt-dlp` de verdade. */
  opcoes: { limiteMs?: number; executar?: ExecutorDeProcesso } = {},
): Promise<string> {
  const pasta = tmpdir();
  const prefixo = `audio-${randomUUID()}`;
  const caminho = join(pasta, `${prefixo}.mp3`);
  const limiteMs = opcoes.limiteMs ?? config.transcricao.ytdlpLimiteS * 1000;

  try {
    await executarComLimite("yt-dlp", argumentosDeAudio(url, plataforma, join(pasta, `${prefixo}.%(ext)s`)), limiteMs, opcoes.executar);
  } catch (erro) {
    // Falhou (ou foi morto pelo limite): o que ele deixou na pasta temporária (`.part`, o mp3 pela metade) não é áudio e não pode sobrar.
    await apagarSobrasDoDownload(pasta, prefixo);
    if (erro instanceof ErroTempoLimite) {
      throw new ErroAudioTempoLimite(`o yt-dlp passou de ${Math.round(limiteMs / 1000)} s baixando o audio de ${url} (tempo limite por video)`);
    }
    // O proxy é que falhou (sem tráfego ou fora do ar): o vídeo não tem culpa, e quem chama não marca nova tentativa nele.
    const motivoDoProxy = motivoDaFalhaDoProxy(String(erro));
    if (motivoDoProxy) throw new ErroAudioDoProxy(motivoDoProxy, `${motivoDoProxy}: o download de ${url} passou pelo proxy e ele recusou`);
    throw new ErroAudio(`nao foi possivel baixar o audio de ${url}: ${ocultarSegredos(String(erro))}`);
  }

  // O `--max-filesize` faz o `yt-dlp` desistir de um arquivo grande demais sem erro, e então não há mp3: é falha do vídeo, e não um arquivo que some depois.
  if (!(await stat(caminho).catch(() => null))) {
    await apagarSobrasDoDownload(pasta, prefixo);
    throw new ErroAudio(`o yt-dlp nao deixou o audio de ${url} (arquivo maior que o limite de ${TAMANHO_MAXIMO_DO_DOWNLOAD} ou download recusado)`);
  }

  return caminho;
}

/** Quantos bytes o áudio baixado tem (o que o proxy carregou, em boa aproximação); 0 se o arquivo já não existe. Nunca lança. */
export async function bytesDoAudio(caminho: string): Promise<number> {
  return (await stat(caminho).catch(() => null))?.size ?? 0;
}

export async function apagarAudio(caminho: string): Promise<void> {
  await rm(caminho, { force: true }).catch(() => undefined);
}
