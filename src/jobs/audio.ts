/**
 * Audio de um video, via yt-dlp mais ffmpeg (etapa 8): so audio, 64 kbps,
 * para as plataformas sem legenda oficial (TikTok, Instagram) e como
 * reforco quando o YouTube nao tem legenda no idioma pedido. yt-dlp baixa
 * de qualquer uma das tres plataformas com a mesma chamada.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class ErroAudio extends Error {}

/** Baixa so o audio em mp3 a 64 kbps; devolve o caminho do arquivo temporario. */
export async function baixarAudio(url: string): Promise<string> {
  const pasta = tmpdir();
  const prefixo = `audio-${randomUUID()}`;
  const caminho = join(pasta, `${prefixo}.mp3`);

  try {
    await execFileAsync("yt-dlp", [
      "-x",
      "--audio-format",
      "mp3",
      "--postprocessor-args",
      "ffmpeg:-b:a 64k",
      "-o",
      join(pasta, `${prefixo}.%(ext)s`),
      url,
    ]);
  } catch (erro) {
    throw new ErroAudio(`nao foi possivel baixar o audio de ${url}: ${String(erro)}`);
  }

  return caminho;
}

export async function apagarAudio(caminho: string): Promise<void> {
  await rm(caminho, { force: true }).catch(() => undefined);
}
