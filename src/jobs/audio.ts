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

import type { Plataforma } from "@/db/schema";

import { argumentosPorPlataforma } from "./youtube-cliente";

const execFileAsync = promisify(execFile);

export class ErroAudio extends Error {}

/**
 * Os argumentos do yt-dlp para baixar so o audio. Pura, para testar sem
 * abrir processo (mesmo padrao de `argumentosDeVideo480p` em `video.ts`).
 */
export function argumentosDeAudio(url: string, plataforma: Plataforma, modeloDeSaida: string): string[] {
  return [
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
 * Baixa so o audio em mp3 a 64 kbps; devolve o caminho do arquivo
 * temporario. `plataforma` e obrigatoria (ajuste 2 da revisao do PR #45,
 * V2a): a url direta de midia da Meta, que `transcrever` e `meta-hashtags`
 * passam, nao tem cara de Instagram pelo host, e o palpite antigo por host
 * mandava esse download pelo proxy (que se paga por gigabyte).
 */
export async function baixarAudio(url: string, plataforma: Plataforma): Promise<string> {
  const pasta = tmpdir();
  const prefixo = `audio-${randomUUID()}`;
  const caminho = join(pasta, `${prefixo}.mp3`);

  try {
    await execFileAsync("yt-dlp", argumentosDeAudio(url, plataforma, join(pasta, `${prefixo}.%(ext)s`)));
  } catch (erro) {
    throw new ErroAudio(`nao foi possivel baixar o audio de ${url}: ${String(erro)}`);
  }

  return caminho;
}

export async function apagarAudio(caminho: string): Promise<void> {
  await rm(caminho, { force: true }).catch(() => undefined);
}
