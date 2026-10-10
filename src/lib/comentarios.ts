/**
 * E28, os comentários do público: a limpeza do que as pessoas escreveram, antes de guardar e antes de mandar ao modelo. É puro (sem
 * banco, sem rede), para o teste que procura nome e endereço no que sai valer para tudo que passa por aqui.
 *
 * O que o produto guarda é o padrão, nunca a pessoa (escopo 5.5, E28): sem nome de usuário, sem foto, sem endereço de perfil. O
 * autor nem entra aqui (o normalizador lê só o texto, as curtidas e a data). Dentro do próprio texto, o que identifica alguém ou
 * leva a alguém sai: @ de menção, endereço de site, e-mail e número de telefone. Emoji sai (o produto não escreve emoji, regra 2, e
 * o modelo lê melhor sem). As classes `\p{...}` abaixo dispensam escrever o caractere: travessão é `\p{Pd}`, o resto do emoji são as
 * marcas invisíveis (`\p{Cf}`, `\p{Variation_Selector}`) e as bandeiras (`\p{Regional_Indicator}`).
 */

/** Abaixo disto o comentário não diz nada que o modelo possa ler ("top", "kkkk", "show"). */
export const COMENTARIO_TAMANHO_MINIMO = 12;
/** Acima disto o resto é cortado, na última palavra inteira: um comentário comprido não vale mais que cinco curtos. */
export const COMENTARIO_TAMANHO_MAXIMO = 400;

const ENTIDADES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };

/** Os dois travessões, sem escrever o caractere (regra 1 do projeto: nem no código). */
const TRAVESSAO = String.fromCharCode(0x2014);
const MEIO_TRAVESSAO = String.fromCharCode(0x2013);

const EMOJI_E_MARCAS =/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\p{Variation_Selector}|\p{Cf}/gu;

/** Número de telefone ou de documento: oito dígitos ou mais, com espaço, ponto, hífen ou parênteses no meio. */
function ehNumeroLongo(trecho: string): boolean {
  return (trecho.match(/\d/g)?.length ?? 0) >= 8;
}

function cortarNaPalavra(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  const corte = texto.slice(0, maximo);
  const ultimo = corte.lastIndexOf(" ");
  return (ultimo > maximo / 2 ? corte.slice(0, ultimo) : corte).trim();
}

/** O texto de um comentário sem o que identifica alguém, ou nulo quando sobra pouco para ler. */
export function limparComentario(texto: string | null | undefined): string | null {
  let t = String(texto ?? "");
  t = t.replace(/<[^>]*>/g, " ");
  t = t.replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, (e) => ENTIDADES[e] ?? " ");
  t = t.replace(/https?:\/\/\S+|www\.\S+/gi, " ");
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ");
  t = t.replace(/@[\p{L}\p{N}_.]+/gu, " ");
  t = t.replace(/\+?\(?\d[\d\s().-]{6,}\d/g, (trecho) => (ehNumeroLongo(trecho) ? " " : trecho));
  t = t.replace(EMOJI_E_MARCAS, " ");
  t = t.replace(/\p{Pd}/gu, "-");
  t = t.replace(/([!?.,])\1{2,}/g, "$1");
  t = t.replace(/\s+/g, " ").trim();

  const letras = t.match(/\p{L}/gu) ?? [];
  const semEspaco = t.replace(/\s/g, "").length;
  if (t.length < COMENTARIO_TAMANHO_MINIMO || semEspaco === 0 || letras.length / semEspaco < 0.6) return null;
  // "kkkkkkkkkkkk" e "aaaaa bbbbb" passam do tamanho, mas não dizem nada: pelo menos duas palavras e cinco letras diferentes.
  if (t.split(" ").length < 2 || new Set(letras.map((l) => l.toLowerCase())).size < 5) return null;

  return cortarNaPalavra(t, COMENTARIO_TAMANHO_MAXIMO);
}

/**
 * O texto que o modelo devolveu (uma pergunta, uma reclamação, um pedido), pronto para a tela: sem travessão, sem emoji, sem @ nem
 * endereço, numa linha só, no tamanho dado. Nulo quando não sobra uma frase de verdade.
 */
export function limparTextoDoModelo(texto: string | null | undefined, maximo: number): string | null {
  let t = String(texto ?? "");
  t = t.replace(/https?:\/\/\S+|www\.\S+/gi, " ");
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ");
  t = t.replace(/@[\p{L}\p{N}_.]+/gu, " ");
  t = t.replace(EMOJI_E_MARCAS, " ");
  t = t.split(TRAVESSAO).join(", ").split(MEIO_TRAVESSAO).join(", ");
  t = t.replace(/\s+/g, " ").replace(/\s+,/g, ",").replace(/,(\s*,)+/g, ",").trim();
  if (t.length < 6 || (t.match(/\p{L}/gu)?.length ?? 0) < 4) return null;
  return cortarNaPalavra(t, maximo);
}

/** A forma de comparar duas frases: minúscula, sem acento, sem pontuação, uma palavra por espaço. */
export function formaDeComparar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
