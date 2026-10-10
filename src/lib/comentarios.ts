/**
 * E28, os comentários do público: a limpeza do que as pessoas escreveram, antes de guardar e antes de mandar ao modelo. É puro (sem
 * banco, sem rede), para o teste que procura nome e endereço no que sai valer para tudo que passa por aqui.
 *
 * O que o produto guarda é o padrão, nunca a pessoa (escopo 5.5, E28): sem nome de usuário, sem foto, sem endereço de perfil. O
 * autor nem entra aqui (o normalizador lê só o texto, as curtidas e a data). Dentro do próprio texto, o que identifica alguém ou
 * leva a alguém sai: @ de menção, endereço de site (com ou sem "https"), e-mail, telefone e CPF. Emoji sai (o produto não escreve
 * emoji, regra 2, e o modelo lê melhor sem). As classes `\p{...}` abaixo dispensam escrever o caractere: travessão é `\p{Pd}`, o
 * resto do emoji são as marcas invisíveis (`\p{Cf}`, `\p{Variation_Selector}`) e as bandeiras (`\p{Regional_Indicator}`).
 *
 * O texto vem do YouTube em `plainText` (sem etiqueta nem entidade): "<3" e "custa < 50" são texto de verdade e ficam.
 */

/** Abaixo disto o comentário não diz nada que o modelo possa ler ("top", "show"), salvo a pergunta curta ("Preço?"). */
export const COMENTARIO_TAMANHO_MINIMO = 12;
/** Acima disto o resto é cortado, na última palavra inteira: um comentário comprido não vale mais que cinco curtos. */
export const COMENTARIO_TAMANHO_MAXIMO = 400;

/** Os dois travessões, sem escrever o caractere (regra 1 do projeto: nem no código). */
const TRAVESSAO = String.fromCharCode(0x2014);
const MEIO_TRAVESSAO = String.fromCharCode(0x2013);

const EMOJI_E_MARCAS = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\p{Variation_Selector}|\p{Cf}/gu;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const MENCAO = /@[\p{L}\p{N}_.]+/gu;
/** Site com protocolo ou "www", ou o domínio sozinho ("instagram.com/fulano", "bit.ly/abc"): é o perfil ou a loja de quem escreveu. */
const ENDERECO =
  /https?:\/\/\S+|www\.\S+|(?:\b[a-z0-9-]+\.)+(?:com|net|org|edu|gov|br|io|me|ly|gg|app|tv|co|link|shop|store|site|online|info|xyz)\b(?:\/\S*)?/gi;
/** Telefone com ou sem país e área, com espaço, ponto ou hífen: dois da área, cinco ou quatro, quatro. Intervalo de preço e data não casam. */
const TELEFONE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?!\d)/g;
const CELULAR_SEM_AREA = /\b9\d{4}[-\s]\d{4}\b/g;
const CPF = /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}\b/g;
const NUMERO_COLADO = /\d{10,}/g;
const CONTROLE = /\p{Cc}/gu;

/** Tira de um texto o que leva a uma pessoa: e-mail, menção, endereço, telefone, CPF, caractere de controle. A ordem importa (e-mail antes de endereço). */
function tirarIdentificadores(texto: string): string {
  return texto
    .replace(EMAIL, " ")
    .replace(MENCAO, " ")
    .replace(ENDERECO, " ")
    .replace(CPF, " ")
    .replace(TELEFONE, " ")
    .replace(CELULAR_SEM_AREA, " ")
    .replace(NUMERO_COLADO, " ")
    .replace(CONTROLE, " ");
}

function cortarNaPalavra(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  const corte = texto.slice(0, maximo);
  const ultimo = corte.lastIndexOf(" ");
  return (ultimo > maximo / 2 ? corte.slice(0, ultimo) : corte).trim();
}

/** O texto de um comentário sem o que identifica alguém, ou nulo quando sobra pouco para ler. */
export function limparComentario(texto: string | null | undefined): string | null {
  let t = tirarIdentificadores(String(texto ?? ""));
  t = t.replace(EMOJI_E_MARCAS, " ");
  t = t.replace(/\p{Pd}/gu, "-");
  t = t.replace(/([!?.,])\1{2,}/g, "$1");
  t = t.replace(/\s+/g, " ").trim();

  const letras = t.match(/\p{L}/gu) ?? [];
  const semEspaco = t.replace(/\s/g, "").length;
  if (semEspaco === 0 || letras.length / semEspaco < 0.6) return null;
  const distintas = new Set(letras.map((l) => l.toLowerCase())).size;

  if (t.endsWith("?")) {
    // A pergunta curta é justamente a mais repetida ("Preço?", "Como faz?"): vale com quatro letras, de três diferentes.
    if (letras.length < 4 || distintas < 3) return null;
  } else if (t.length < COMENTARIO_TAMANHO_MINIMO || t.split(" ").length < 2 || distintas < 5) {
    // "kkkkkkkkkkkk" e "aaaaa bbbbb" passam do tamanho, mas não dizem nada: pelo menos duas palavras e cinco letras diferentes.
    return null;
  }

  return cortarNaPalavra(t, COMENTARIO_TAMANHO_MAXIMO);
}

/**
 * O texto que o modelo devolveu (uma pergunta, uma reclamação, um pedido), pronto para a tela: sem travessão, sem emoji, sem @,
 * endereço, e-mail nem telefone, numa linha só, no tamanho dado. Nulo quando não sobra uma frase de verdade.
 */
export function limparTextoDoModelo(texto: string | null | undefined, maximo: number): string | null {
  let t = tirarIdentificadores(String(texto ?? ""));
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
