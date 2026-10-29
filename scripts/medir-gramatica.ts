/**
 * Mede se o schema de saída de uma tarefa cabe na gramática da API (E50, 22/10/2026: o roteiro curto falhou 22 de 22 com "The compiled grammar is too large" porque o schema, já no limite,
 * ganhou uma lista de objetos; só a prova com chave real pegou). Manda uma entrada de uma palavra com `max_tokens` 16 e o modelo forte: o erro de gramática vem antes de qualquer geração, então
 * a medição custa quase nada (a resposta truncada é esperada e conta como "cabe"). Também diz a FOLGA: se uma lista de objetos a mais ainda caberia.
 *
 * Rode antes de subir qualquer mudança em `schema` de `src/ia/prompts/roteiro.ts` ou `roteiroLongo.ts`: `npm run medir:gramatica` (usa a chave de `.env`, `MODELO` troca o modelo).
 */
import "./chave-de-testes";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import * as decidirEdicao from "../src/ia/prompts/decidirEdicao";
import * as roteiro from "../src/ia/prompts/roteiro";
import * as longo from "../src/ia/prompts/roteiroLongo";
import * as verificarEdicao from "../src/ia/prompts/verificarEdicao";
import { config } from "../src/lib/config";

const cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const modelo = process.env.MODELO ?? config.ia.modeloForte;

async function cabe(schema: z.ZodType, modeloDaMedida: string = modelo): Promise<boolean> {
  try {
    await cliente.messages.parse({ model: modeloDaMedida, max_tokens: 16, messages: [{ role: "user", content: "oi" }], output_config: { format: zodOutputFormat(schema) } });
    return true;
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    if (mensagem.includes("grammar is too large")) return false;
    // a saída truncada em 16 tokens não é JSON: a gramática passou
    if (mensagem.includes("Failed to parse structured output")) return true;
    throw e;
  }
}

const listaExtra = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`extra${i}`, z.array(z.object({ a: z.string(), b: z.string().nullable() }))]));

async function medir(nome: string, schema: z.ZodObject<z.ZodRawShape>, modeloDaMedida: string = modelo): Promise<boolean> {
  const passa = await cabe(schema, modeloDaMedida);
  let folga = "-";
  if (passa) folga = (await cabe(z.object({ ...schema.shape, ...listaExtra(1) }), modeloDaMedida)) ? "cabe mais uma lista de objetos" : "SEM folga (uma lista de objetos a mais estoura)";
  console.log(`${nome} (${modeloDaMedida}): ${passa ? "CABE" : "GRAMATICA GRANDE DEMAIS"}; ${folga}`);
  return passa;
}

async function main() {
  const resultados = [
    await medir("roteiro (curto)", roteiro.schema),
    await medir("roteiro longo", longo.schema),
    // E47 PR 3: a decisão da edição (modelo forte) e o verificador da edição (modelo barato).
    await medir("decisão da edição", decidirEdicao.schema),
    await medir("verificador da edição", verificarEdicao.schema, config.ia.modeloBarato),
  ];
  process.exitCode = resultados.every(Boolean) ? 0 : 1;
}
void main();
