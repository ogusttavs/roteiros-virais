/**
 * API de lote (estrategia/referencia-sdk-anthropic.md): cria um lote e
 * coleta os resultados por custom_id, mais tarde, num job separado. Sem uso
 * ainda (entra na etapa 8, extracao noturna); testado em mock aqui.
 *
 * A API de lote nao tem uma versao "parse" que devolve parsed_output: o
 * resultado de cada item e uma Message normal, entao o texto e lido do
 * primeiro bloco de texto e validado pelo schema aqui mesmo.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

import { config } from "@/lib/config";

import { construirSaidaMock } from "./mock";
import type { NivelIA, TarefaIA } from "./tipos";

const MAX_TOKENS_LOTE_PADRAO = 4000;

let clienteAnthropic: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!clienteAnthropic) clienteAnthropic = new Anthropic();
  return clienteAnthropic;
}

export type ItemLote<T> = {
  customId: string;
  tarefa: TarefaIA;
  nivel: NivelIA;
  schema: z.ZodType<T>;
  sistemaEstavel: string;
  entrada: string;
  maxTokens?: number;
};

const lotesMock = new Map<string, ItemLote<unknown>[]>();

export async function criarLote<T>(itens: ItemLote<T>[]): Promise<string> {
  if (config.ia.provedor === "mock") {
    const id = `mock-lote-${itens.length}-itens-${lotesMock.size}`;
    lotesMock.set(id, itens as ItemLote<unknown>[]);
    return id;
  }

  const lote = await anthropic().messages.batches.create({
    requests: itens.map((item) => ({
      custom_id: item.customId,
      params: {
        model: item.nivel === "forte" ? config.ia.modeloForte : config.ia.modeloBarato,
        max_tokens: item.maxTokens ?? MAX_TOKENS_LOTE_PADRAO,
        system: [
          { type: "text" as const, text: item.sistemaEstavel, cache_control: { type: "ephemeral" as const } },
        ],
        messages: [{ role: "user" as const, content: item.entrada }],
        output_config: { format: zodOutputFormat(item.schema) },
      },
    })),
  });

  return lote.id;
}

export type EstadoLote = "em_andamento" | "concluido";

export async function statusLote(loteId: string): Promise<EstadoLote> {
  if (config.ia.provedor === "mock") return "concluido";

  const estado = await anthropic().messages.batches.retrieve(loteId);
  return estado.processing_status === "ended" ? "concluido" : "em_andamento";
}

export type ResultadoLoteItem<T> =
  | { customId: string; status: "sucesso"; dados: T; modelo: string; tokensEntrada: number; tokensSaida: number }
  | { customId: string; status: "erro"; motivo: string }
  | { customId: string; status: "expirado" };

/**
 * Sem uso real ate a etapa 8. Em mock, usa os itens guardados por
 * criarLote (na memoria do processo; um job separado de verdade, em
 * producao, nao precisa disso porque a API de lote guarda tudo do lado
 * dela).
 */
export async function coletarResultadosLote<T>(
  loteId: string,
  schema: z.ZodType<T>,
): Promise<ResultadoLoteItem<T>[]> {
  if (config.ia.provedor === "mock") {
    const itens = (lotesMock.get(loteId) ?? []) as ItemLote<T>[];
    return itens.map((item) => ({
      customId: item.customId,
      status: "sucesso" as const,
      dados: schema.parse(construirSaidaMock(item.tarefa, item.entrada)),
      modelo: "mock",
      tokensEntrada: 0,
      tokensSaida: 0,
    }));
  }

  const resultados: ResultadoLoteItem<T>[] = [];
  for await (const linha of await anthropic().messages.batches.results(loteId)) {
    resultados.push(interpretarLinhaDoLote(linha, schema));
  }
  return resultados;
}

function interpretarLinhaDoLote<T>(
  linha: Anthropic.Messages.MessageBatchIndividualResponse,
  schema: z.ZodType<T>,
): ResultadoLoteItem<T> {
  const { custom_id: customId, result } = linha;

  if (result.type === "errored") {
    return { customId, status: "erro", motivo: JSON.stringify(result.error) };
  }
  if (result.type !== "succeeded") {
    return { customId, status: "expirado" };
  }

  const blocoTexto = result.message.content.find(
    (bloco): bloco is Anthropic.Messages.TextBlock => bloco.type === "text",
  );
  if (!blocoTexto) {
    return { customId, status: "erro", motivo: "resposta sem bloco de texto" };
  }

  try {
    const dados = schema.parse(JSON.parse(blocoTexto.text));
    return {
      customId,
      status: "sucesso",
      dados,
      modelo: result.message.model,
      tokensEntrada: result.message.usage.input_tokens,
      tokensSaida: result.message.usage.output_tokens,
    };
  } catch (erro) {
    return { customId, status: "erro", motivo: `saida nao validou o schema: ${String(erro)}` };
  }
}

