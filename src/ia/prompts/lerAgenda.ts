import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Separa a agenda que a pessoa colou ou falou em dias (V9b, item 1, "o plano
 * colado"): mesmo espírito de `lerMomento.ts`, tarefa pequena e barata, sem
 * verificador. A data de cada dia NÃO sai daqui: o modelo devolve
 * `referenciaDia` (o jeito que a pessoa se referiu ao dia, "segunda",
 * "amanhã", "dia 3"), e quem resolve a data de verdade é
 * `src/lib/data-relativa.ts`, por código, para nunca inventar uma conta de
 * calendário nem um dia que a pessoa não citou.
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

const diaSchema = z.object({
  /** Como a pessoa se referiu ao dia, literalmente ("segunda", "amanhã", "dia 3", "hoje"). */
  referenciaDia: z.string(),
  /** O lugar onde ela vai estar nesse dia; vazio quando ela não disse. */
  lugar: z.string(),
  compromissos: z.array(z.string()),
});

export const schema = z.object({ dias: z.array(diaSchema) });

export type SaidaLerAgenda = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você lê a agenda de uma viagem ou de uma semana de trabalho, contada em texto livre ou
falada, e separa em dias.

Para cada dia que a pessoa citou, devolva:
- referenciaDia: exatamente como ela se referiu a esse dia ("segunda", "amanhã", "dia 3",
  "hoje"). Nunca resolva a data você mesmo, isso é feito por código depois.
- lugar: onde ela vai estar nesse dia (a cidade, o lugar, "voo para X"). Deixe vazio se ela não
  disse onde vai estar.
- compromissos: a lista do que ela disse que vai fazer nesse dia, cada item curto, nas palavras
  dela.

Nunca invente um dia que ela não citou nem um compromisso que ela não disse. Português do
Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: { texto: string }): string {
  return `A agenda que a pessoa contou:\n${dados.texto}`;
}
