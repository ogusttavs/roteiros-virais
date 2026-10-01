import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * P2, item 3: antes de entrar no campo como a resposta da pessoa, a fala transcrita passa por
 * aqui. Mesmo espírito de `lerMomento.ts` (tarefa pequena e barata, sem verificador: a pessoa vê
 * e edita antes de confirmar), mas para uma resposta de briefing inteira em vez de três campos do
 * momento: tira "é", "tipo", repetição e hesitação, mantém as palavras da pessoa, nunca acrescenta
 * fato novo nem resume para menos da metade.
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export const schema = z.object({
  textoOrganizado: z.string(),
});

export type SaidaOrganizarFalaBriefing = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você organiza por escrito o que uma pessoa respondeu falando, para uma pergunta de um
formulário. A fala vem com "é", "tipo", repetição, hesitação e frases inacabadas.

Tire só as muletas de fala e a repetição; mantenha as palavras e as frases da pessoa como ela
disse. Nunca troque uma palavra por outra mais "bonita", nunca acrescente um fato que ela não
disse, e nunca resuma para menos da metade do que ela falou: o objetivo é limpar, não encurtar.

Se ela gaguejou ou recomeçou uma frase, fique só com a versão final que ela quis dizer.

Sem travessão, sem emoji. Português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: { pergunta: string; textoFalado: string }): string {
  return `Pergunta: ${dados.pergunta}

O que a pessoa falou:
${dados.textoFalado}`;
}
