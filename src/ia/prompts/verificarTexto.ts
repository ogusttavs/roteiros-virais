import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Segunda camada do verificador (src/ia/verificador.ts): checagens locais
 * (regex) ja cobrem travessao, emoji e a lista fixa de jargao da secao 8 do
 * brief-frontend.md, entao esta tarefa nao precisa repetir essa lista. Ela
 * cobre o que regex nao pega: tom, naturalidade e as proibicoes do
 * proprio cliente (P10 do briefing), que sao dado por cliente, nunca uma
 * lista fixa.
 */
export const versao = "1.1.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export const schema = z.object({
  aprovado: z.boolean(),
  motivo: z.string().nullable(),
});

export type SaidaVerificarTexto = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você confere um texto que vai para a tela de um dono de pequeno negócio. Aprove só
se:
- o tom é direto, calmo e de parceiro, sem exclamação e sem entusiasmo forçado;
- o texto soa como uma pessoa falando com outra pessoa, não como propaganda;
- nenhuma proibição que o cliente listou no briefing foi ferida.

Reprove e diga o motivo em uma frase, sem travessão, quando alguma dessas coisas falhar.
Não repita o texto inteiro na resposta, só o motivo.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: { texto: string; proibicoes: string[] }): string {
  const listaProibicoes =
    dados.proibicoes.length > 0 ? dados.proibicoes.join("; ") : "nenhuma proibicao registrada";

  return `Texto a conferir:\n${dados.texto}\n\nProibicoes do cliente: ${listaProibicoes}`;
}
