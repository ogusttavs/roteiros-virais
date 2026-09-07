/**
 * Checagem barata de idioma (acabamento visual 2, achado do Gustavo no
 * iPad: duas análises de vídeo saíram em inglês ou misturadas, apesar de o
 * prompt pedir português). Sem chamar IA: conta a proporção de palavras
 * funcionais do português numa lista fixa. `extrair-coleta.ts` usa isto
 * campo a campo (o vídeo pode ter só um trecho copiado no idioma original,
 * como o gancho, com o resto da análise certo).
 *
 * O limiar e o tamanho mínimo são uma hipótese (os dois casos reais de
 * 06/09 não sobreviveram fora de `avaliacoes-privadas/`, que esta sessão
 * não acessa): abaixo de 6 palavras o texto não dá sinal confiável e passa
 * direto: PROXIMO.md pediu um limiar "conferido nos dois casos reais",
 * decisão pendente registrada em TODO.md para o Fable confirmar contra o
 * diário real quando houver um novo caso.
 */
const PALAVRAS_FUNCIONAIS_PT = ["de", "que", "nao", "com", "para", "uma", "voce", "mais"];

const PALAVRAS_MINIMAS = 6;
const LIMIAR_PROPORCAO = 0.06;

/** Sem acento, para "você"/"nao" baterem com texto que escreve sem acento (mock, digitação rápida). */
function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function pareceTextoEmPortugues(texto: string): boolean {
  const palavras = semAcento(texto.toLowerCase()).match(/\p{L}+/gu) ?? [];
  if (palavras.length < PALAVRAS_MINIMAS) return true;

  const funcionais = palavras.filter((palavra) => PALAVRAS_FUNCIONAIS_PT.includes(palavra)).length;
  return funcionais / palavras.length >= LIMIAR_PROPORCAO;
}
