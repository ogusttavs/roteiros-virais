import { z } from "zod";

/**
 * Segunda camada do verificador (src/ia/verificador.ts): checagens locais
 * (regex) ja cobrem travessao, emoji e a lista fixa de jargao da secao 8 do
 * brief-frontend.md, entao esta tarefa nao precisa repetir essa lista. Ela
 * cobre o que regex nao pega: tom, naturalidade e as proibicoes do
 * proprio cliente (P10 do briefing), que sao dado por cliente, nunca uma
 * lista fixa.
 */
export const versao = "1.0.0";

export const schema = z.object({
  aprovado: z.boolean(),
  motivo: z.string().nullable(),
});

export type SaidaVerificarTexto = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Voce confere um texto que vai para a tela de um dono de pequeno negocio. Aprove so
se:
- o tom e direto, calmo e de parceiro, sem exclamacao e sem entusiasmo forcado;
- o texto soa como uma pessoa falando com outra pessoa, nao como propaganda;
- nenhuma proibicao que o cliente listou no briefing foi ferida.

Reprove e diga o motivo em uma frase, sem travessao, quando alguma dessas coisas falhar.
Nao repita o texto inteiro na resposta, so o motivo.`;
}

export function montarEntrada(dados: { texto: string; proibicoes: string[] }): string {
  const listaProibicoes =
    dados.proibicoes.length > 0 ? dados.proibicoes.join("; ") : "nenhuma proibicao registrada";

  return `Texto a conferir:\n${dados.texto}\n\nProibicoes do cliente: ${listaProibicoes}`;
}
