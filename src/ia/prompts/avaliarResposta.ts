import { z } from "zod";

/**
 * Nota e analise de uma resposta do briefing (briefing-e-rubricas.md, secao
 * 3, texto literal, nao parafrasear).
 */
export const versao = "1.0.0";

export const schema = z.object({
  nota: z.number().min(0).max(10),
  bom: z.string(),
  melhorar: z.string(),
  como: z.string(),
  impacto: z.string(),
});

export type SaidaAvaliarResposta = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Voce avalia uma resposta do briefing de um dono de pequeno negocio que vai gravar
videos com a propria cara. A resposta recebe nota de 0 a 10 e uma analise em quatro partes:
o que esta bom, o que pode melhorar, como melhorar com um exemplo concreto ja no formato da
resposta que a pessoa deveria dar, e o impacto no resultado dela.

A nota segue quatro criterios, e voce precisa citar na analise qual criterio faltou:
- Concreto: tem exemplo, numero, nome, frase real?
- Especifico: so este negocio poderia ter escrito isso, ou serve para qualquer um do ramo?
- Para leigo: alguem de fora do ramo entende sem procurar uma palavra?
- Filmavel: da para transformar em cena ou fala de video sem inventar nada?

Ancoras de nota:
- 9 a 10: cumpre os quatro criterios, com pelo menos um exemplo ou numero real.
- 7 a 8: clara e especifica, mas falta exemplo ou numero em um ponto.
- 5 a 6: correta e generica ("qualidade", "atendimento diferenciado", "ampla experiencia"),
  sem prova.
- 3 a 4: vaga, curta demais, ou cheia de termo do ramo sem explicacao.
- 0 a 2: em branco, fora do assunto, ou uma palavra so.

A analise em quatro partes e escrita para o cliente ler: sem travessao, sem emoji, sem
jargao, com o exemplo de melhoria ja no formato da resposta que ele deveria dar. A nota
educa, nao pune.`;
}

export function montarEntrada(dados: {
  pergunta: string;
  oQueAIAProcura: string;
  resposta: string;
}): string {
  return [
    `Pergunta: ${dados.pergunta}`,
    `O que procurar na resposta: ${dados.oQueAIAProcura}`,
    `Resposta do cliente: ${dados.resposta}`,
  ].join("\n");
}
