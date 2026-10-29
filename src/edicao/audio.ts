/**
 * E47 PR 2: o áudio do vídeo bruto para a Groq e para o motor de corte. Uma só passada do ffmpeg, duas saídas: um WAV de 16 kHz mono (o que vai à Groq: uns 2 MB por minuto) e as mesmas
 * amostras em PCM cru de 16 bits, de onde sai a curva de energia (`calcularEnergiaDeS16le`, janelas de 10 ms). O que fica na pasta de trabalho é apagado por quem chamou.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { executarComLimite, type ExecutorDeProcesso } from "@/jobs/processo";

import { calcularEnergiaDeS16le } from "./energia";
import type { Energia } from "./tipos";

export const TAXA_DO_AUDIO = 16_000;
const LIMITE_DO_FFMPEG_MS = 120_000;
/** Mesmo que o arquivo diga mais, o ffmpeg só lê isto (a duração máxima aceita mais a folga). */
const SEGUNDOS_LIDOS_NO_MAXIMO = 190;

export class ErroDeAudio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeAudio";
  }
}

export function argumentosDoAudio(video: string, wav: string, pcm: string): string[] {
  const saida = ["-vn", "-map", "0:a:0", "-ac", "1", "-ar", String(TAXA_DO_AUDIO), "-c:a", "pcm_s16le"];
  return ["-nostdin", "-y", "-v", "error", "-t", String(SEGUNDOS_LIDOS_NO_MAXIMO), "-i", video, ...saida, "-f", "wav", wav, ...saida, "-f", "s16le", pcm];
}

export type AudioPreparado = { wav: string; energia: Energia };

/** Extrai o áudio de `video` para `pasta` (`audio.wav` e `audio.pcm`) e calcula a energia. Lança `ErroDeAudio` se o ffmpeg não consegue. */
export async function prepararAudio(video: string, pasta: string, executar?: ExecutorDeProcesso): Promise<AudioPreparado> {
  const wav = join(pasta, "audio.wav");
  const pcm = join(pasta, "audio.pcm");
  try {
    await executarComLimite("ffmpeg", argumentosDoAudio(video, wav, pcm), LIMITE_DO_FFMPEG_MS, executar);
    const bytes = await readFile(pcm);
    if (bytes.byteLength < 2 * TAXA_DO_AUDIO) throw new ErroDeAudio("o audio extraido tem menos de um segundo");
    return { wav, energia: calcularEnergiaDeS16le(bytes, TAXA_DO_AUDIO) };
  } catch (erro) {
    if (erro instanceof ErroDeAudio) throw erro;
    throw new ErroDeAudio("o ffmpeg nao conseguiu extrair o audio");
  }
}
