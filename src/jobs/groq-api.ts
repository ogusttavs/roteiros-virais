/**
 * Cliente fino da Groq (etapa 8): so transcricao, `response_format: "json"`
 * (com "text" o SDK devolve a string crua, sem o objeto `{ text }` que o
 * tipo declara; confirmado rodando contra a API de verdade).
 */
import { createReadStream } from "node:fs";

import Groq from "groq-sdk";

import { config } from "@/lib/config";

export class ErroGroq extends Error {}

let cliente: Groq | null = null;

function groq(): Groq {
  if (!cliente) cliente = new Groq({ apiKey: config.transcricao.groqKey });
  return cliente;
}

export async function transcreverAudio(caminhoArquivo: string, idioma = "pt"): Promise<string> {
  try {
    const resultado = await groq().audio.transcriptions.create({
      model: config.transcricao.groqModel,
      file: createReadStream(caminhoArquivo),
      language: idioma,
      response_format: "json",
    });
    return resultado.text.trim();
  } catch (erro) {
    throw new ErroGroq(`transcricao da Groq falhou: ${String(erro)}`);
  }
}
