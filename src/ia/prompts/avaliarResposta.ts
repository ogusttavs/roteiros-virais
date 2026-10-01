import { z } from "zod";

import type { TipoMarca } from "@/db/schema";
import { JARGAO } from "@/lib/regras-de-texto";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Nota e analise de uma resposta do briefing (briefing-e-rubricas.md, secao
 * 3, texto literal, nao parafrasear).
 *
 * 1.4.0 (revisao do PR #27, item 3): a 1.3.0 so proibia uma palavra fixa da
 * lista `JARGAO` (src/lib/regras-de-texto.ts); na rodada seguinte com chave
 * real uma pergunta reprovou por causa de outra palavra da mesma lista.
 * Agora a instrucao vem da lista inteira, montada em tempo de execucao (ver
 * `montarSistemaEstavel`), entao uma palavra nova na lista de regras ja
 * entra no prompt sem precisar mexer aqui.
 *
 * 1.5.0 (P1, item 3, briefing-e-rubricas.md, secao 2b): a marca do tipo
 * pessoa ganha uma linha em `montarEntrada` (nao no sistema estavel, para o
 * cache de prompt continuar valendo entre chamadas do negocio) dizendo que
 * o critério "Específico" pergunta "só você poderia ter escrito isso?", sem
 * pedir diferencial de produto de quem nao tem produto (achado do Gustavo
 * fazendo o briefing da pessoa).
 *
 * 1.6.0 (H2, achado do Gustavo em 29/09/2026, no briefing da Overtake Pro: a
 * P4 recebeu 7,0 com a instrução de escolher "uma pessoa real" e dizer
 * "primeiro nome, idade, bairro ou cidade"): o critério "Concreto" deixa de
 * pedir nome de pessoa (copiado de `briefing-e-rubricas.md`, seção 3, sem
 * reescrever); regra dura nova proíbe pedir nome, bairro, endereço ou
 * telefone que identifique um cliente de verdade, com o que um retrato bem
 * descrito já cumpre; o exemplo de "como melhorar" segue a mesma regra.
 */
export const versao = "1.6.0";
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
 * Uma linha por entrada de `JARGAO` (ajuste de 06/09/2026, revisão do PR
 * #27, item 3): "nunca escreva X, diga Y", com a mesma troca que
 * `src/lib/regras-de-texto.ts` já usa para reprovar o texto de tela. Monta
 * em tempo de execução porque o `checar-texto` reprova qualquer arquivo de
 * `src/ia/prompts/` que tenha a palavra escrita inteira (é assim que ele
 * pega o jargão no texto de tela); este arquivo só referencia `item.palavra`
 * e `item.usar`, nunca a palavra em si.
 */
function montarInstrucaoJargao(): string {
  return JARGAO.map((item) => `Nunca escreva "${item.palavra}", diga "${item.usar}".`).join("\n");
}

export function montarSistemaEstavel(): string {
  return `Você avalia uma resposta do briefing de um dono de pequeno negócio que vai gravar
vídeos com a própria cara. A resposta recebe nota de 0 a 10 e uma análise em cinco partes:
o que está bom, o que pode melhorar, como melhorar, um exemplo da resposta melhorada, e o
impacto no resultado dela.

Em "como", diga o que fazer: o critério que faltou e a instrução para corrigir. Em
"exemplo", escreva a resposta melhorada, no formato que o cliente deveria ter escrito, em
primeira pessoa, como se fosse a própria resposta dele reescrita.

A nota segue quatro critérios, e você precisa citar na análise qual critério faltou:
- Concreto: tem exemplo, número, frase real, ou nome de coisa (produto, lugar, evento, marca)?
  Nome de pessoa nunca é exigido.
- Específico: só este negócio poderia ter escrito isso, ou serve para qualquer um do ramo?
- Para leigo: alguém de fora do ramo entende sem procurar uma palavra?
- Filmável: dá para transformar em cena ou fala de vídeo sem inventar nada?

Nunca peça nome, bairro, endereço ou telefone que identifique um cliente de verdade. Um tipo
de cliente bem descrito (quem é, o que faz, em que situação está) cumpre "Concreto" sozinho;
quem atende mais de um público descreve os dois; quem vende para empresa descreve quem decide
a compra lá dentro. O exemplo que você escreve em "como" segue a mesma regra: nunca invente um
nome de pessoa, use "um cliente", "uma empresária", "o dono da loja ao lado".

Âncoras de nota:
- 9 a 10: cumpre os quatro critérios, com pelo menos um exemplo ou número real.
- 7 a 8: clara e específica, mas falta exemplo ou número em um ponto.
- 5 a 6: correta e genérica ("qualidade", "atendimento diferenciado", "ampla experiência"),
  sem prova.
- 3 a 4: vaga, curta demais, ou cheia de termo do ramo sem explicação.
- 0 a 2: em branco, fora do assunto, ou uma palavra só.

A análise inteira, incluindo o exemplo, é escrita para o cliente ler: sem travessão, sem
emoji, sem jargão. Nunca escreva estas palavras, use a troca do lado:
${montarInstrucaoJargao()}
A nota educa, não pune.

Escreva em português do Brasil, com acentuação correta. A resposta do cliente pode vir sem
acento nenhum; a sua análise sai sempre acentuada, mesmo assim.`;
}

export function montarEntrada(dados: {
  pergunta: string;
  oQueAIAProcura: string;
  resposta: string;
  tipo?: TipoMarca;
}): string {
  const linhas = [
    `Pergunta: ${dados.pergunta}`,
    `O que procurar na resposta: ${dados.oQueAIAProcura}`,
    `Resposta do cliente: ${dados.resposta}`,
  ];
  if (dados.tipo === "pessoa") {
    linhas.push(
      'Esta marca é uma pessoa, não um negócio: no critério Específico, a pergunta certa é "só você poderia ter escrito isso?", nunca peça diferencial de produto para quem não tem produto para vender.',
    );
  }
  return linhas.join("\n");
}
