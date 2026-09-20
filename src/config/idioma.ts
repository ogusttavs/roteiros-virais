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
/** Regra do item (c) da revisão do PR #46: com exatamente 2 palavras, ambas da lista do português, o mínimo cai para 2. */
const PALAVRAS_MINIMAS_QUANDO_AMBAS_PT = 2;

/**
 * Palavras funcionais do português, incluindo as citadas no PROXIMO.md
 * ("que", "não", "para", "com", "você"); "que" e "para" existem também em
 * espanhol, mas os sinais exclusivos de cada lista (abaixo) desempatam um
 * texto realmente escrito no outro idioma.
 *
 * Ampliada na revisão do PR #46 (medição em 600 vídeos reais: 23% voltavam
 * nulos, quase todos português de título curto). A ordem pedia também "no" e
 * "hoje"; "hoje" já estava na lista (fica sem duplicar) e "no" fica de fora
 * por conta própria, além dos três que a ordem já excluía ("como", "casa",
 * "nada"): é a negação espanhola mais comum ("no vas a creer..."), e
 * incluído fazia empatar um teste de espanhol existente (2 a 2 com "que"),
 * devolvendo null em vez de "es". Decisão registrada em TODO.md, "Decisões
 * pendentes".
 */
const PALAVRAS_PT = [
  "que", "não", "nao", "para", "com", "você", "voce", "muito", "hoje", "então", "entao", "já",
  "ja", "também", "tambem", "isso", "essa", "esse", "até", "ate", "fazer", "mostra", "seu",
  "sua", "são", "sao", "vídeo", "video", "olha", "aí", "ai", "né", "ne", "pra", "porque",
  "do", "da", "dos", "das", "na", "nas", "nos", "em", "um", "uma", "meu", "minha", "vem",
  "aqui", "mais", "sem", "depois", "antes", "quando", "onde", "quem", "tudo", "coisa", "gente",
  "dia", "dicas", "limpeza", "limpar", "faxina",
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
/**
 * Sufixos acrescentados na revisão do PR #46, para título curto sem nenhuma
 * palavra funcional de sinal (achado da medição em 600 vídeos: "vizinho
 * curioso #humor", "maleta de maquiagem", "cheguei no interior" não tinham
 * nenhum sinal com a lista de palavras e o dicionário de hashtag sozinhos).
 * Decisão própria, registrada em TODO.md: diminutivo -inho/-inha (ex.:
 * "vizinho", sem equivalente em espanhol, que usa -ito/-ita) e pretérito de
 * verbo em -car/-gar na primeira pessoa, -quei/-guei (ex.: "cheguei",
 * "joguei"; o espanhol equivalente termina em -qué/-gué, sem o "i").
 */
const SUFIXO_DIMINUTIVO_PT = /inh[oa]\b/giu;
const SUFIXO_PRETERITO_PT = /(gu|qu)ei\b/giu;
/** Sufixo -agem (ex.: "maquiagem", "lavagem"); o espanhol equivalente é -aje, sem o "m" final. */
const SUFIXO_AGEM_PT = /agem\b/giu;
/** ñ só existe em espanhol, entre os idiomas considerados aqui. */
const TIL_ES = /ñ/gi;

/**
 * Radicais de hashtag do português (item (b) da revisão do PR #46): uma
 * hashtag como "#donadecasa" ou "#vidademae" não bate com nenhuma palavra
 * inteira da lista, mas contém um desses radicais. Cada hashtag que contém
 * pelo menos um radical soma 1 ponto para português, não importa quantos
 * radicais ela contém.
 */
const RADICAIS_PT_HASHTAG = [
  "dona", "casa", "limpeza", "faxina", "dicas", "vida", "mae", "receita", "organizacao",
];

function contarOcorrencias(texto: string, regex: RegExp): number {
  return texto.match(regex)?.length ?? 0;
}

function pontosHashtagPt(minusculo: string): number {
  const hashtags = minusculo.match(/#\p{L}+/gu) ?? [];
  return hashtags.filter((hashtag) => RADICAIS_PT_HASHTAG.some((radical) => hashtag.includes(radical))).length;
}

/**
 * `null` quando não dá para saber (texto curto, alfabeto latino sem
 * nenhum sinal, ou dois idiomas empatados no topo da contagem).
 */
export function detectarIdioma(texto: string): Idioma {
  if (ALFABETO_NAO_LATINO.test(texto)) return "outro";

  const minusculo = texto.toLowerCase();
  const palavras = minusculo.match(/\p{L}+/gu) ?? [];
  const ambasPt = palavras.length === 2 && palavras.every((palavra) => CONJUNTO_PT.has(palavra));
  const minimoNecessario = ambasPt ? PALAVRAS_MINIMAS_QUANDO_AMBAS_PT : PALAVRAS_MINIMAS;
  if (palavras.length < minimoNecessario) return null;

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
  pt += 2 * contarOcorrencias(minusculo, SUFIXO_DIMINUTIVO_PT);
  pt += 2 * contarOcorrencias(minusculo, SUFIXO_PRETERITO_PT);
  pt += 2 * contarOcorrencias(minusculo, SUFIXO_AGEM_PT);
  pt += pontosHashtagPt(minusculo);
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

/**
 * Mapeia um codigo de idioma BCP-47/ISO 639-1 (ex.: "pt-BR", "en-US",
 * "es-419", "ja") para o mesmo enum de `detectarIdioma` (V2b, item 2): o
 * `defaultAudioLanguage`/`defaultLanguage` que o YouTube devolve para o
 * video, quando o canal preencheu. So os dois primeiros caracteres
 * importam; qualquer codigo que nao seja pt/en/es vira "outro" (o YouTube
 * so devolve um codigo quando o canal de fato declarou um, nunca inventa),
 * e a ausencia do campo devolve null.
 */
export function idiomaDoCodigoIso(codigo: string | null | undefined): Idioma {
  if (!codigo) return null;
  const prefixo = codigo.slice(0, 2).toLowerCase();
  if (prefixo === "pt") return "pt";
  if (prefixo === "en") return "en";
  if (prefixo === "es") return "es";
  return "outro";
}
