/**
 * Porta unica para toda chamada de IA (plataforma/CLAUDE.md: nada fora de
 * src/ia/ importa o SDK; scripts/verificar-import-sdk.test.ts trava isso).
 * Uso e formas exatas em estrategia/referencia-sdk-anthropic.md.
 */
import Anthropic, { APIConnectionError, APIError, RateLimitError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

import { config } from "@/lib/config";

import { ErroIA } from "./erro";
import { gerarMock } from "./mock";
import type { EsforcoIA, ImagemEntrada, NivelIA, ResultadoGeracao, TarefaIA } from "./tipos";

const LIMITE_STREAMING = 4000;
const MAX_TOKENS_PADRAO = 16000;

let clienteAnthropic: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!clienteAnthropic) clienteAnthropic = new Anthropic();
  return clienteAnthropic;
}

export type ParametrosGeracao<T> = {
  tarefa: TarefaIA;
  nivel: NivelIA;
  schema: z.ZodType<T>;
  /** Regras, rubrica, perfil compilado, modelo do nicho: cacheado, nunca data ou id. */
  sistemaEstavel: string;
  /** Bloco de sistema nao cacheado, raro; a parte que muda vai em `entrada`. */
  sistemaVariavel?: string;
  entrada: string;
  imagens?: ImagemEntrada[];
  maxTokens?: number;
  effort?: EsforcoIA;
};

export async function gerarEstruturado<T>(
  params: ParametrosGeracao<T>,
): Promise<ResultadoGeracao<T>> {
  if (config.ia.provedor === "mock") {
    return gerarMock(params);
  }
  return gerarReal(params);
}

async function gerarReal<T>(params: ParametrosGeracao<T>): Promise<ResultadoGeracao<T>> {
  const modelo = params.nivel === "forte" ? config.ia.modeloForte : config.ia.modeloBarato;
  const maxTokens = params.maxTokens ?? MAX_TOKENS_PADRAO;

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: params.sistemaEstavel, cache_control: { type: "ephemeral" } },
  ];
  if (params.sistemaVariavel) {
    system.push({ type: "text", text: params.sistemaVariavel });
  }

  const content: Anthropic.MessageParam["content"] = params.imagens?.length
    ? [
        ...params.imagens.map((imagem): Anthropic.ImageBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: imagem.mediaType, data: imagem.base64 },
        })),
        { type: "text", text: params.entrada },
      ]
    : params.entrada;

  const outputConfig: Anthropic.OutputConfig = { format: zodOutputFormat(params.schema) };
  if (params.effort && params.nivel === "forte") {
    outputConfig.effort = params.effort;
  }

  const corpo: Anthropic.MessageCreateParamsNonStreaming = {
    model: modelo,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
    output_config: outputConfig,
  };

  let mensagem: Anthropic.Message & { parsed_output?: T | null };
  try {
    mensagem =
      maxTokens > LIMITE_STREAMING
        ? await anthropic().messages.stream(corpo).finalMessage()
        : await anthropic().messages.parse(corpo);
  } catch (erro) {
    throw traduzirErro(erro, params.tarefa);
  }

  if (mensagem.stop_reason === "refusal") {
    throw new ErroIA(`recusa do modelo na tarefa "${params.tarefa}"`);
  }
  if (mensagem.stop_reason === "max_tokens") {
    throw new ErroIA(`saida truncada na tarefa "${params.tarefa}" (max_tokens ${maxTokens})`);
  }

  const dados = mensagem.parsed_output;
  if (dados === null || dados === undefined) {
    throw new ErroIA(`saida da tarefa "${params.tarefa}" nao validou o schema`);
  }

  return {
    dados,
    modelo,
    tokensEntrada: mensagem.usage.input_tokens,
    tokensSaida: mensagem.usage.output_tokens,
    tokensCacheLeitura: mensagem.usage.cache_read_input_tokens ?? 0,
    tokensCacheEscrita: mensagem.usage.cache_creation_input_tokens ?? 0,
  };
}

function traduzirErro(erro: unknown, tarefa: TarefaIA): ErroIA {
  if (erro instanceof RateLimitError) {
    return new ErroIA(`limite de taxa da API na tarefa "${tarefa}": ${erro.message}`);
  }
  if (erro instanceof APIConnectionError) {
    return new ErroIA(`falha de rede com a API na tarefa "${tarefa}": ${erro.message}`);
  }
  if (erro instanceof APIError) {
    return new ErroIA(`erro da API (${erro.status}) na tarefa "${tarefa}": ${erro.message}`);
  }
  return new ErroIA(`erro inesperado na tarefa "${tarefa}": ${String(erro)}`);
}
