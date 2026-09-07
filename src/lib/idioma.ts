/**
 * Checagem barata de idioma (acabamento visual 2, achado do Gustavo no
 * iPad: duas análises de vídeo saíram em inglês ou misturadas, apesar de o
 * prompt pedir português). Sem chamar IA. `extrair-coleta.ts` usa isto
 * campo a campo (o vídeo pode ter só um trecho copiado no idioma original,
 * como o gancho, com o resto da análise certo).
 *
 * Duas listas fixas, não uma proporção (revisão do PR #30, Fable): a
 * primeira versão (proporção de oito palavras funcionais do português)
 * reprovava 37 dos 135 campos das 27 análises reais de produção, e uns 18
 * eram português correto. Comparando a contagem de palavras de cada lista
 * nos mesmos 135 campos, esta versão reprova 20, todos de fato em inglês,
 * zero falso positivo (números e as duas listas vieram do comentário de
 * revisão do PR #30).
 */
const PALAVRAS_PT = [
  "o", "a", "os", "as", "e", "de", "do", "da", "dos", "das", "no", "na", "nos", "nas", "em",
  "um", "uma", "por", "se", "ao", "à", "é", "são", "como", "mais", "seu", "sua", "ele", "ela",
  "isso", "este", "esta", "esse", "essa", "para", "pra", "com", "não", "que", "mas", "ou", "já",
  "até", "também", "você", "depois", "antes", "sem", "quando", "onde", "muito", "bem", "tudo",
  "vai", "foi", "ser", "ter", "fazer", "mostra", "mostrando", "vídeo",
];

const PALAVRAS_EN = [
  "the", "and", "you", "your", "this", "that", "what", "with", "will", "it", "is", "are", "to",
  "of", "in", "on", "like", "just", "when", "how", "why", "not", "never", "it's", "you'll",
  "i'd", "me", "my", "we", "again", "wait", "because", "until", "into", "from", "but", "or",
  "so", "if", "can", "all", "one", "these", "up", "out", "about",
];

const PALAVRAS_MINIMAS = 4;

/** Sem acento, para "você"/"não" baterem com texto que escreve sem acento (mock, digitação rápida). */
function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const CONJUNTO_PT = new Set(PALAVRAS_PT.map(semAcento));
const CONJUNTO_EN = new Set(PALAVRAS_EN);

/** Reprova só quando a contagem de palavras da lista em inglês é maior que a da lista em português. Empate passa. */
export function pareceTextoEmPortugues(texto: string): boolean {
  const palavras = semAcento(texto.toLowerCase()).match(/[\p{L}']+/gu) ?? [];
  if (palavras.length < PALAVRAS_MINIMAS) return true;

  let pt = 0;
  let en = 0;
  for (const palavra of palavras) {
    if (CONJUNTO_PT.has(palavra)) pt += 1;
    if (CONJUNTO_EN.has(palavra)) en += 1;
  }
  return en <= pt;
}
