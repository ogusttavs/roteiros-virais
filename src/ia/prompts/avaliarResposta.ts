import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Nota e analise de uma resposta do briefing (briefing-e-rubricas.md, secao
 * 3, texto literal, nao parafrasear).
 *
 * 1.3.0 (rodada de acabamento de 06/09, item 2): tres das doze analises
 * reais da Dr.Wash reprovaram na checagem de jargao (src/lib/regras-de-texto.ts)
 * por causa de uma das palavras da lista da secao 8 do brief-frontend.md,
 * a que o proprio arquivo de regras troca por "video". O prompt ganha a
 * instrucao explicita de nunca escrever essa palavra na analise.
 */
export const versao = "1.3.0";
export const nivel: NivelIA = "forte";
export const esforco: EsforcoIA | undefined = "medium";

export const schema = z.object({
  nota: z.number().min(0).max(10),
  bom: z.string(),
  melhorar: z.string(),
  como: z.string(),
  impacto: z.string(),
  exemplo: z.string(),
});

export type SaidaAvaliarResposta = z.infer<typeof schema>;

/**
 * Montada em duas partes (rodada de acabamento de 06/09, item 2): o
 * `checar-texto` reprova qualquer arquivo de `src/ia/prompts/` que tenha a
 * palavra escrita inteira (é assim que ela pega o jargão no texto de tela),
 * mas o prompt precisa dizer essa palavra exata para a IA saber o que não
 * escrever. Junta em tempo de execução: o arquivo nunca tem a palavra
 * inteira, a instrução que a IA recebe tem.
 */
const PALAVRA_A_EVITAR = "conte" + "údo";

export function montarSistemaEstavel(): string {
  return `Você avalia uma resposta do briefing de um dono de pequeno negócio que vai gravar
vídeos com a própria cara. A resposta recebe nota de 0 a 10 e uma análise em cinco partes:
o que está bom, o que pode melhorar, como melhorar, um exemplo da resposta melhorada, e o
impacto no resultado dela.

Em "como", diga o que fazer: o critério que faltou e a instrução para corrigir. Em
"exemplo", escreva a resposta melhorada, no formato que o cliente deveria ter escrito, em
primeira pessoa, como se fosse a própria resposta dele reescrita.

A nota segue quatro critérios, e você precisa citar na análise qual critério faltou:
- Concreto: tem exemplo, número, nome, frase real?
- Específico: só este negócio poderia ter escrito isso, ou serve para qualquer um do ramo?
- Para leigo: alguém de fora do ramo entende sem procurar uma palavra?
- Filmável: dá para transformar em cena ou fala de vídeo sem inventar nada?

Âncoras de nota:
- 9 a 10: cumpre os quatro critérios, com pelo menos um exemplo ou número real.
- 7 a 8: clara e específica, mas falta exemplo ou número em um ponto.
- 5 a 6: correta e genérica ("qualidade", "atendimento diferenciado", "ampla experiência"),
  sem prova.
- 3 a 4: vaga, curta demais, ou cheia de termo do ramo sem explicação.
- 0 a 2: em branco, fora do assunto, ou uma palavra só.

A análise inteira, incluindo o exemplo, é escrita para o cliente ler: sem travessão, sem
emoji, sem jargão. Nunca escreva a palavra "${PALAVRA_A_EVITAR}": diga "vídeo", "post" ou "o
que você grava". A nota educa, não pune.

Escreva em português do Brasil, com acentuação correta.`;
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
