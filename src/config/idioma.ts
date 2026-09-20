/**
 * Deteccao barata de idioma por codigo, sem IA (V2b, item 2, escopo 5.11: o
 * Brasil primeiro). Alfabeto nao latino (chines, japones, coreano, arabe,
 * cirilico, tailandes, hindi) vira "outro" na hora, sem mais checagem;
 * senao, portugues, ingles e espanhol por contagem de palavras funcionais
 * mais um bonus por acentuacao e sufixo caracteristicos de cada um. Texto
 * curto demais ou sem sinal nenhum (nenhum idioma pontua, ou dois empatam
 * no topo) devolve null: quem chama trata null como "nao sabe", nunca como
 * "internacional" (regra do PROXIMO.md, "nunca chute").
 *
 * Diferente dos outros dois detectores que ja existem no repo, com
 * proposito mais estreito: `temIndicioDeBrasil` (`src/config/brasil.ts`) so
 * responde "e Brasil ou nao" (pais, boolean, sem meio-termo), usado so na
 * Hashtag Search da Meta; `pareceTextoEmPortugues` (`src/lib/idioma.ts`) so
 * confere se a saida da IA ficou em portugues (contra ingles, sem terceiro
 * estado), usada so em `extrair-coleta.ts`. Este e o unico dos tres que
 * detecta o idioma de origem do titulo/legenda de um video, com espanhol e
 * com o estado "nao sei".
 */

export type Idioma = "pt" | "en" | "es" | "outro" | null;

/**
 * Ranges Unicode dos alfabetos nao latinos mais comuns em video viral:
 * CJK unificado e hiragana/katakana (chines/japones), hangul (coreano),
 * arabe, cirilico (russo), tailandes, devanagari (hindi).
 */
const ALFABETO_NAO_LATINO =
  /[一-鿿぀-ヿㇰ-ㇿ가-힯؀-ۿݐ-ݿЀ-ӿ฀-๿ऀ-ॿ]/;

const PALAVRAS_MINIMAS = 3;

/**
 * Palavras funcionais do português, incluindo as citadas no PROXIMO.md
 * ("que", "não", "para", "com", "você"); "que" e "para" existem também em
 * espanhol, mas os sinais exclusivos de cada lista (abaixo) desempatam um
 * texto realmente escrito no outro idioma.
 */
const PALAVRAS_PT = [
  "que", "não", "nao", "para", "com", "você", "voce", "muito", "hoje", "então", "entao", "já",
  "ja", "também", "tambem", "isso", "essa", "esse", "até", "ate", "fazer", "mostra", "seu",
  "sua", "são", "sao", "vídeo", "video", "olha", "aí", "ai", "né", "ne", "pra", "porque",
];

const PALAVRAS_EN = [
  "the", "and", "you", "your", "this", "that", "what", "with", "will", "is", "are", "like",
  "just", "when", "how", "why", "never", "watch", "here", "now", "guys", "check", "of", "to",
  "about", "it",
];

const PALAVRAS_ES = [
  "el", "la", "los", "las", "muy", "pero", "años", "anos", "tú", "usted", "gracias", "hola",
  "según", "segun", "ahora", "mira", "esto", "eso", "así", "asi", "cómo", "es", "son",
  "también", "tambien", "quiero",
];

const CONJUNTO_PT = new Set(PALAVRAS_PT);
const CONJUNTO_EN = new Set(PALAVRAS_EN);
const CONJUNTO_ES = new Set(PALAVRAS_ES);

/** ã/õ praticamente só existem em português, entre os idiomas latinos comuns numa legenda. */
const VOGAL_NASAL_PT = /[ãõ]/gi;
/** Sufixo -ção/-ções/-ões, forte mesmo sem nenhuma palavra funcional (ex.: "transformação", "opções"). */
const SUFIXO_PT = /ç(ão|ões)/giu;
/** ñ só existe em espanhol, entre os idiomas considerados aqui. */
const TIL_ES = /ñ/gi;

function contarOcorrencias(texto: string, regex: RegExp): number {
  return texto.match(regex)?.length ?? 0;
}

/**
 * `null` quando não dá para saber (texto curto, alfabeto latino sem
 * nenhum sinal, ou dois idiomas empatados no topo da contagem).
 */
export function detectarIdioma(texto: string): Idioma {
  if (ALFABETO_NAO_LATINO.test(texto)) return "outro";

  const minusculo = texto.toLowerCase();
  const palavras = minusculo.match(/\p{L}+/gu) ?? [];
  if (palavras.length < PALAVRAS_MINIMAS) return null;

  let pt = 0;
  let en = 0;
  let es = 0;
  for (const palavra of palavras) {
    if (CONJUNTO_PT.has(palavra)) pt += 1;
    if (CONJUNTO_EN.has(palavra)) en += 1;
    if (CONJUNTO_ES.has(palavra)) es += 1;
  }
  pt += 2 * contarOcorrencias(minusculo, VOGAL_NASAL_PT);
  pt += 2 * contarOcorrencias(minusculo, SUFIXO_PT);
  es += 2 * contarOcorrencias(minusculo, TIL_ES);

  const maximo = Math.max(pt, en, es);
  if (maximo === 0) return null;

  const vencedores = [
    ["pt", pt],
    ["en", en],
    ["es", es],
  ].filter(([, pontos]) => pontos === maximo);
  if (vencedores.length !== 1) return null;

  return vencedores[0][0] as Idioma;
}
