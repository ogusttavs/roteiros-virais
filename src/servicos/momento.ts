/**
 * O momento (V9a, item 3, "Gravar agora"): grava o áudio enviado num
 * arquivo temporário, transcreve pela Groq e separa os três campos com a
 * tarefa `lerMomento`. `src/app/api/momento/transcrever/route.ts` só cuida
 * de sessão e do corpo da requisição; a lógica de verdade mora aqui, e
 * `momento/acoes.ts` chama `gerarLerMomentoDeTexto` direto no caminho por
 * texto (a pessoa ignorou o áudio e escreveu).
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { consumoApi } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as lerMomentoIA from "@/ia/prompts/lerMomento";
import { registrarGeracao } from "@/ia/registro";
import { apagarAudio } from "@/jobs/audio";
import { transcreverAudio } from "@/jobs/groq-api";
import { hojeISO } from "@/lib/config";
import { logger } from "@/lib/log";

export class ErroMomento extends Error {}

/** O `MediaRecorder` do navegador para no máximo isso (PROXIMO.md, item 3); a rota recusa áudio mais longo. */
export const LIMITE_SEGUNDOS_AUDIO = 120;

/**
 * Item 0.2 da revisão do PR #55 (V9b): o mesmo limite de arquivo que a
 * própria Groq impõe. Sem isso, um `duracaoS` mentiroso (o navegador manda,
 * a rota confiava sem conferir) deixava passar um arquivo de qualquer
 * tamanho antes mesmo de escrever no disco. A rota confere isto antes de ler
 * `audio.arrayBuffer()`, pelo `size` do próprio `File` do FormData.
 */
export const LIMITE_TAMANHO_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * `MediaRecorder` grava webm/opus no Chrome e no Android, mp4/aac no Safari
 * (PROXIMO.md, item 3: "aceitar os dois com mimeType"). A extensão é só
 * para o arquivo temporário ter um nome legível; a Groq detecta o formato
 * pelo conteúdo, não pela extensão.
 */
const EXTENSAO_POR_TIPO_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
};

export function extensaoDoTipoMime(tipoMime: string): string {
  const base = tipoMime.split(";")[0]?.trim() ?? tipoMime;
  return EXTENSAO_POR_TIPO_MIME[base] ?? "webm";
}

/** Escreve o áudio enviado num arquivo temporário; devolve o caminho (`apagarAudio` limpa depois). */
export async function salvarAudioTemporario(bytes: Buffer, tipoMime: string): Promise<string> {
  const caminho = join(tmpdir(), `momento-${randomUUID()}.${extensaoDoTipoMime(tipoMime)}`);
  await writeFile(caminho, bytes);
  return caminho;
}

/**
 * Registra o consumo da Groq em `consumo_api`, fonte "groq" (PROXIMO.md,
 * item 3, "o custo entra em consumo_api na fonte groq como a transcrição de
 * vídeo"). Divergência registrada em `TODO.md`: `jobs/transcrever.ts` não
 * grava em `consumo_api` hoje, só no resumo do job
 * (`custoEstimadoGroqUsd`); esta é a primeira vez que a Groq entra nessa
 * tabela. `unidades` são segundos de áudio, o dado que a folha já tem (o
 * cronômetro da gravação), sem precisar abrir o arquivo para medir duração.
 */
async function registrarConsumoGroq(segundos: number): Promise<void> {
  const unidades = Math.max(1, Math.round(segundos));
  await db()
    .insert(consumoApi)
    .values({ fonte: "groq", data: hojeISO(), unidades })
    .onConflictDoUpdate({
      target: [consumoApi.fonte, consumoApi.data],
      set: { unidades: sql`${consumoApi.unidades} + ${unidades}`, atualizadoEm: new Date() },
    });
}

export type CamposMomento = { onde: string; oQueEstaAcontecendo: string; oQueDaParaMostrar: string };

/**
 * A tarefa `lerMomento` (barata, sem verificador, mesmo espírito de
 * `classificarAbertura`, ver `ia/prompts/lerMomento.ts`): separa o texto
 * (falado ou digitado) nos três campos da folha.
 */
export async function lerMomentoDeTexto(texto: string): Promise<CamposMomento> {
  const resultado = await gerarEstruturado({
    tarefa: "lerMomento",
    nivel: lerMomentoIA.nivel,
    effort: lerMomentoIA.esforco,
    schema: lerMomentoIA.schema,
    sistemaEstavel: lerMomentoIA.montarSistemaEstavel(),
    entrada: lerMomentoIA.montarEntrada({ texto }),
  });

  await registrarGeracao({
    tarefa: "lerMomento",
    versaoPrompt: lerMomentoIA.versao,
    modelo: resultado.modelo,
    nivel: lerMomentoIA.nivel,
    entradas: { texto },
    saida: resultado.dados,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
  });

  return resultado.dados;
}

export type ResultadoTranscreverMomento = CamposMomento & { transcricao: string };

/**
 * O caminho por áudio da folha "Gravar agora": salva o blob enviado, chama
 * a Groq, separa os campos, e sempre apaga o arquivo temporário (sucesso ou
 * erro). `duracaoS` vem do cronômetro do navegador (o front sabe a duração
 * exata; abrir o arquivo para medir de novo seria redundante).
 */
export async function transcreverMomento(
  bytes: Buffer,
  tipoMime: string,
  duracaoS: number,
): Promise<ResultadoTranscreverMomento> {
  if (duracaoS > LIMITE_SEGUNDOS_AUDIO) {
    throw new ErroMomento(`audio maior que o limite de ${LIMITE_SEGUNDOS_AUDIO}s: ${duracaoS}s`);
  }

  const caminho = await salvarAudioTemporario(bytes, tipoMime);
  try {
    const transcricao = await transcreverAudio(caminho, "pt");
    await registrarConsumoGroq(duracaoS).catch((erro) => {
      // Nunca derruba a transcrição por causa da cota (mesmo espírito de curva-cliente.ts): registrar é
      // um bônus para acompanhar custo, não uma condição para a pessoa conseguir o roteiro.
      logger.error({ err: erro }, "nao foi possivel registrar o consumo da groq (momento)");
    });

    if (!transcricao.trim()) {
      throw new ErroMomento("a transcricao veio vazia.");
    }

    const campos = await lerMomentoDeTexto(transcricao);
    return { ...campos, transcricao };
  } finally {
    await apagarAudio(caminho);
  }
}
