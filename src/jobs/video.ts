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

const execFileAsync = promisify(execFile);

const LARGURA_QUADRO = 640;

export class ErroVideo extends Error {}

/** Baixa o video em ate 480p (video mais audio); devolve o caminho temporario. */
export async function baixarVideo480p(url: string): Promise<string> {
  const caminho = join(tmpdir(), `video-${randomUUID()}.mp4`);

  try {
    await execFileAsync("yt-dlp", [
      "-f",
      "bv*[height<=480]+ba/b[height<=480]",
      "--merge-output-format",
      "mp4",
      "-o",
      caminho,
      url,
    ]);
  } catch (erro) {
    throw new ErroVideo(`nao foi possivel baixar o video de ${url}: ${String(erro)}`);
  }

  return caminho;
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
