/**
 * Download de video em 480p e extracao de quadros, via yt-dlp mais ffmpeg
 * (etapa 9, decisao 1 do PROXIMO.md): fonte da analise visual semanal.
 * Mesmo padrao de `audio.ts` (etapa 8): arquivo temporario, sempre apagado.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { argumentosYoutube, ehUrlDoYoutube } from "./youtube-cliente";

const execFileAsync = promisify(execFile);

const LARGURA_QUADRO = 640;

export class ErroVideo extends Error {}

export function ehUrlDoInstagram(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

/**
 * Seletor de formato do yt-dlp (transcricao do YouTube, rodada 2, item 3a):
 * o Instagram so entrega formato progressivo (video e audio juntos, sem
 * `bv*`/`ba` separados, achado conferido no extrator `instagram.py` do
 * yt-dlp em 10/09/2026, `_extract_product_media`, so `video_versions` com
 * `height`, nunca video-only/audio-only). O seletor do YouTube e do TikTok
 * (`bv*[height<=480]+ba/b[height<=480]`) pede primeiro um merge de
 * video-only mais audio-only; no Instagram isso nunca bate (sem `bv*`) e
 * caia no fallback `b[height<=480]`, que tambem falhava com "Requested
 * format is not available" quando o Reel nao tem nenhum formato a 480p ou
 * menos. `b[height<=480]/b` tenta o progressivo mais proximo de 480p e,
 * sem nenhum, cai pro melhor progressivo disponivel, nunca fica sem
 * formato.
 */
export function seletorDeFormato(url: string): string {
  return ehUrlDoInstagram(url) ? "b[height<=480]/b" : "bv*[height<=480]+ba/b[height<=480]";
}

/** Baixa o video em ate 480p (video mais audio); devolve o caminho temporario. */
export async function baixarVideo480p(url: string): Promise<string> {
  const caminho = join(tmpdir(), `video-${randomUUID()}.mp4`);

  try {
    await execFileAsync("yt-dlp", [
      "-f",
      seletorDeFormato(url),
      "--merge-output-format",
      "mp4",
      // So o YouTube precisa do cliente sem PO Token (TikTok e Instagram nao passam por aqui).
      ...(ehUrlDoYoutube(url) ? argumentosYoutube() : []),
      "-o",
      caminho,
      url,
    ]);
  } catch (erro) {
    throw new ErroVideo(`nao foi possivel baixar o video de ${url}: ${String(erro)}`);
  }

  return caminho;
}

/**
 * Duracao do arquivo baixado, em segundos, via `ffprobe` (transcricao do
 * YouTube, rodada 2, item 3b): video vindo da Business Discovery/Hashtag
 * Search da Meta (E6 parte 3, segunda rodada) nunca grava `duracao_s` (a
 * API da Meta nao devolve isso), e `analisarUm` lancava "video sem duracao
 * conhecida" antes mesmo de tentar o download. Chamada so quando
 * `videos.duracao_s` esta nulo, com o arquivo ja baixado.
 */
/** Funcao pura: o `stdout` do ffprobe (`-of csv=p=0`) e so o numero de segundos, decimal, numa linha. */
export function interpretarDuracaoFfprobe(stdout: string): number {
  const segundos = Number(stdout.trim());
  if (!Number.isFinite(segundos) || segundos <= 0) {
    throw new ErroVideo(`ffprobe nao devolveu uma duracao valida: "${stdout.trim()}"`);
  }
  return Math.round(segundos);
}

export async function duracaoDoArquivoS(caminhoVideo: string): Promise<number> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      caminhoVideo,
    ]));
  } catch (erro) {
    throw new ErroVideo(`nao foi possivel ler a duracao de ${caminhoVideo} com ffprobe: ${String(erro)}`);
  }

  return interpretarDuracaoFfprobe(stdout);
}

export async function apagarVideo(caminho: string): Promise<void> {
  await rm(caminho, { force: true }).catch(() => undefined);
}

export type QuadroExtraido = { segundo: number; base64: string };

/**
 * Extrai um quadro JPEG por instante em `temposS` (largura 640), devolvido
 * ja em base64. O arquivo temporario de cada quadro e apagado antes de
 * devolver: quadro baixado nunca vai para o repositorio nem para o PR
 * (`PROXIMO.md`, regras de trabalho).
 */
export async function extrairQuadros(caminhoVideo: string, temposS: number[]): Promise<QuadroExtraido[]> {
  const quadros: QuadroExtraido[] = [];

  for (const segundo of temposS) {
    const caminhoQuadro = join(tmpdir(), `quadro-${randomUUID()}.jpg`);
    try {
      await execFileAsync("ffmpeg", [
        "-ss",
        String(segundo),
        "-i",
        caminhoVideo,
        "-frames:v",
        "1",
        "-vf",
        `scale=${LARGURA_QUADRO}:-1`,
        "-q:v",
        "2",
        "-y",
        caminhoQuadro,
      ]);
      const buffer = await readFile(caminhoQuadro);
      quadros.push({ segundo, base64: buffer.toString("base64") });
    } catch (erro) {
      throw new ErroVideo(`nao foi possivel extrair o quadro em ${segundo}s: ${String(erro)}`);
    } finally {
      await apagarVideo(caminhoQuadro);
    }
  }

  return quadros;
}
