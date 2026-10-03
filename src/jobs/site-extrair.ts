/**
 * Funções puras do leitor de site (E38, PR 2): validar o endereço salvo, decodificar o
 * HTML, tirar o texto e os links com o parse5, escolher quais páginas ler, entender o
 * robots.txt e o sitemap, reconhecer página de desafio, limpar e limitar o texto. Nada
 * aqui abre conexão: quem fala com a rede é `site-api.ts`, que chama estas funções com
 * o que a rede devolveu. Isso deixa quase tudo testável sem soquete.
 *
 * Duas decisões de segurança vivem neste arquivo:
 * - `validarUrlDeLeitura` recusa tudo que não é um site público comum (só https, sem
 *   usuário e senha, porta 443, nome com ponto, IP literal só se for público). É a
 *   primeira camada; a que de fato fecha o SSRF é a checagem do IP no momento da conexão
 *   (`lookupSeguro` em `site-api.ts`).
 * - O texto que sai daqui é material de terceiros e vai para um modelo de IA: tira `<` e
 *   `>`, caracteres invisíveis, e-mail e telefone, e nunca devolve telefone ou e-mail do
 *   JSON-LD.
 *
 * Mantenha este arquivo fora do que o `src/app` importa: ele arrasta o parse5 para o
 * bundle web.
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { parse, type DefaultTreeAdapterMap } from "parse5";

import { enderecoEhPublico } from "@/lib/ip-publico";

/* ------------------------------------------------------------------ */
/* Limites de texto (política da seção 7 do levantamento)              */
/* ------------------------------------------------------------------ */

export const TEXTO_MAXIMO_POR_PAGINA = 6_000;
export const TEXTO_MAXIMO_TOTAL = 20_000;
/** Soma mínima de texto das páginas lidas; abaixo disso o site é tratado como "sem texto". */
export const MINIMO_SOMA_CARACTERES = 400;
/** Mínimo de texto na home; abaixo disso o site é tratado como "sem texto". */
export const MINIMO_HOME_CARACTERES = 200;
/** Uma página com menos texto que isto (depois de tirar o que já veio antes) não vale ser enviada. */
export const MINIMO_TEXTO_UTIL = 40;
/** Se o teto total já deixou menos que isto de orçamento, a página seguinte nem entra. */
export const MINIMO_RESTANTE_DO_ORCAMENTO = 200;
/** Quantos links candidatos a leitura a home pode render (depois de filtrar e pontuar). */
export const LINKS_CANDIDATOS_MAXIMOS = 60;

const LINKS_BRUTOS_MAXIMOS = 600;
const LINHA_MAXIMA = 1_500;
const COLETA_MAXIMA_CARACTERES = 80_000;
const MINIMO_ANTES_DO_FALLBACK = 200;
const TEXTO_CURTO_DO_BLOCO_DE_COOKIE = 1_500;
const TITULO_MAXIMO = 200;
const DESCRICAO_MAXIMA = 400;

/* ------------------------------------------------------------------ */
/* Endereço                                                            */
/* ------------------------------------------------------------------ */

export type ProblemaDeUrl = {
  motivo: "endereco_invalido" | "endereco_privado" | "rede_social";
  detalhe: string;
};

export type UrlValidada = { ok: true; url: URL } | ({ ok: false } & ProblemaDeUrl);

const SUFIXOS_DE_REDE_INTERNA = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
  ".localdomain",
  ".intranet",
  ".private",
];

/** Redes sociais e páginas de links: o perfil já é lido pelas APIs das plataformas (PR 1). */
const HOSTS_DE_REDE_SOCIAL = [
  "instagram.com",
  "facebook.com",
  "fb.com",
  "fb.me",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "threads.net",
  "wa.me",
  "whatsapp.com",
  "t.me",
  "linktr.ee",
  "beacons.ai",
  "bio.site",
  "taplink.cc",
  "linkin.bio",
  "lnk.bio",
  "campsite.bio",
];

function semColchetes(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * Primeira camada contra SSRF, pura e lexical: https, sem usuário e senha, porta 443 (ou
 * nenhuma), nome com ponto e sem ponto sobrando, sem sufixo de rede interna, e IP literal
 * só se for público (`enderecoEhPublico`). Devolve uma cópia normalizada (nome sem o ponto
 * final). Vale para o endereço salvo e para cada salto de redirecionamento e cada link.
 */
export function validarUrlDeLeitura(entrada: URL): UrlValidada {
  const url = new URL(entrada.href);

  if (url.protocol !== "https:") {
    return { ok: false, motivo: "endereco_invalido", detalhe: "so https e aceito" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, motivo: "endereco_invalido", detalhe: "endereco com usuario ou senha" };
  }
  if (url.port !== "") {
    return { ok: false, motivo: "endereco_invalido", detalhe: "so a porta 443 e aceita" };
  }

  const host = url.hostname.toLowerCase();
  if (host.startsWith("[")) {
    const ip = semColchetes(host);
    if (isIP(ip) !== 6)
      return { ok: false, motivo: "endereco_invalido", detalhe: "endereco IPv6 invalido" };
    return enderecoEhPublico(ip)
      ? { ok: true, url }
      : { ok: false, motivo: "endereco_privado", detalhe: "endereco IPv6 nao publico" };
  }
  if (isIP(host) === 4) {
    return enderecoEhPublico(host)
      ? { ok: true, url }
      : { ok: false, motivo: "endereco_privado", detalhe: "endereco IPv4 nao publico" };
  }

  const semPonto = host.endsWith(".") ? host.slice(0, -1) : host;
  if (
    semPonto === "" ||
    semPonto.length > 253 ||
    semPonto.startsWith(".") ||
    semPonto.endsWith(".") ||
    semPonto.includes("..")
  ) {
    return { ok: false, motivo: "endereco_invalido", detalhe: "nome de dominio invalido" };
  }
  if (semPonto === "localhost" || semPonto.endsWith(".localhost")) {
    return { ok: false, motivo: "endereco_privado", detalhe: "localhost nao e um site publico" };
  }
  if (!semPonto.includes(".")) {
    return { ok: false, motivo: "endereco_invalido", detalhe: "nome de dominio sem ponto" };
  }
  if (SUFIXOS_DE_REDE_INTERNA.some((sufixo) => semPonto.endsWith(sufixo))) {
    return { ok: false, motivo: "endereco_privado", detalhe: "nome de rede interna" };
  }

  if (semPonto !== host) url.hostname = semPonto;
  return { ok: true, url };
}

/** `true` para rede social ou página de links (com ou sem "www.", "m." e subdomínios). */
export function ehRedeSocialOuLinkHub(host: string): boolean {
  const limpo = host.toLowerCase().replace(/\.$/, "");
  return HOSTS_DE_REDE_SOCIAL.some((rede) => limpo === rede || limpo.endsWith(`.${rede}`));
}

/** O que a leitura aceita como "o mesmo site": o host exato ou a variante com ou sem "www.". */
export function mesmoSite(hostA: string, hostB: string): boolean {
  const limpar = (host: string) =>
    host
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
  return limpar(hostA) === limpar(hostB);
}

export type SiteNormalizado =
  | { ok: true; url: string; host: string }
  | { ok: false; motivo: ProblemaDeUrl["motivo"]; detalhe: string };

/**
 * Reparseia o endereço que a marca salvou (a coluna guarda o texto cru): valida pela
 * primeira camada e separa rede social e link-hub (motivo `rede_social`, sem ler).
 */
export function normalizarUrlDoSite(bruta: string): SiteNormalizado {
  let url: URL;
  try {
    url = new URL(bruta.trim());
  } catch {
    return { ok: false, motivo: "endereco_invalido", detalhe: "nao e uma URL" };
  }
  const validada = validarUrlDeLeitura(url);
  if (!validada.ok) return { ok: false, motivo: validada.motivo, detalhe: validada.detalhe };
  if (ehRedeSocialOuLinkHub(validada.url.hostname)) {
    return {
      ok: false,
      motivo: "rede_social",
      detalhe: "o site informado e uma rede social ou pagina de links",
    };
  }
  validada.url.hash = "";
  return { ok: true, url: validada.url.href, host: validada.url.hostname };
}

/* ------------------------------------------------------------------ */
/* Decodificação do corpo                                              */
/* ------------------------------------------------------------------ */

const ROTULOS_LATIN1 = new Set([
  "iso-8859-1",
  "iso8859-1",
  "iso_8859-1",
  "latin1",
  "latin-1",
  "l1",
  "us-ascii",
  "ascii",
  "cp1252",
  "windows-1252",
  "x-cp1252",
]);

function bomDeCharset(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

function rotuloDoHeader(contentType: string | null): string | null {
  if (!contentType) return null;
  const achado = /charset\s*=\s*"?([^";\s,]+)/i.exec(contentType);
  return achado ? achado[1].toLowerCase() : null;
}

function rotuloDoMeta(bytes: Uint8Array): string | null {
  const inicio = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  const achado = /<meta[^>]{0,300}?charset\s*=\s*["']?\s*([a-z0-9_.:-]+)/i.exec(inicio);
  if (!achado) return null;
  const rotulo = achado[1].toLowerCase();
  /** Um <meta> escrito em ASCII que declara UTF-16 só pode estar errado: o documento é lido como UTF-8. */
  return rotulo.startsWith("utf-16") ? "utf-8" : rotulo;
}

/**
 * Qual codificação usar: BOM, depois o `charset` do Content-Type, depois o `<meta
 * charset>` dos primeiros 1024 bytes. Sem nenhum dos três devolve `null` (a decodificação
 * tenta UTF-8 e cai para windows-1252). ISO-8859-1 e "latin1" viram windows-1252, como
 * manda o padrão da web (acentos estragam se isso for ignorado: site brasileiro antigo).
 */
export function detectarCharset(contentType: string | null, bytes: Uint8Array): string | null {
  const rotulo = bomDeCharset(bytes) ?? rotuloDoHeader(contentType) ?? rotuloDoMeta(bytes);
  if (!rotulo) return null;
  return ROTULOS_LATIN1.has(rotulo) ? "windows-1252" : rotulo;
}

/**
 * Bytes para texto. Rótulo declarado e inválido (`RangeError` do TextDecoder) cai em
 * UTF-8. Sem rótulo, tenta UTF-8 estrito (o trecho final cortado pelo teto de bytes não
 * conta como erro) e, se os bytes não forem UTF-8 de verdade, lê como windows-1252.
 */
export function decodificarCorpo(bytes: Uint8Array, contentType: string | null): string {
  const rotulo = detectarCharset(contentType, bytes);
  if (rotulo) {
    try {
      return new TextDecoder(rotulo).decode(bytes);
    } catch (erro) {
      if (!(erro instanceof RangeError)) throw erro;
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/* ------------------------------------------------------------------ */
/* Limpeza de texto                                                    */
/* ------------------------------------------------------------------ */

const CARACTERES_INVISIVEIS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]/g;
const CARACTERES_DE_CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const PADRAO_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const PADRAO_TELEFONE_INTERNACIONAL = /\+\s?\d[\d\s().-]{7,20}\d/g;
const PADRAO_TELEFONE_BR =
  /(?<![\w.])(?:\(\s?\d{2}\s?\)|\d{2})\s?(?:9\s?)?\d{4}[\s.-]?\d{4}(?!\d)/g;
const PADRAO_TELEFONE_0800 = /(?<![\w.])0[3589]00[\s.-]?\d{3}[\s.-]?\d{3,4}(?!\d)/g;
const PADRAO_TELEFONE_COM_ROTULO =
  /\b(tel(?:efone)?|fone|whats(?:app)?|zap|cel(?:ular)?|ligue|chame|phone|call)\b[\s:.-]*\+?[\d()\s.-]{7,20}\d/gi;

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "");
}

function colapsarEspacos(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/**
 * Tira e-mail e telefone de uma linha (é conteúdo público de marketing, mas é barato e
 * defensável não mandar dado de contato ao modelo). Heurística: cobre os formatos
 * brasileiros comuns e qualquer número com "+".
 */
export function removerDadosDeContato(linha: string): string {
  let resultado = linha;
  if (resultado.includes("@")) resultado = resultado.replace(PADRAO_EMAIL, " ");
  if (/\d{7}|\d[\s.()-]+\d/.test(resultado)) {
    resultado = resultado
      .replace(PADRAO_TELEFONE_COM_ROTULO, "$1 ")
      .replace(PADRAO_TELEFONE_INTERNACIONAL, " ")
      .replace(PADRAO_TELEFONE_0800, " ")
      .replace(PADRAO_TELEFONE_BR, " ");
  }
  return resultado;
}

/** Limpa uma linha de texto de terceiros: invisíveis, controle, `<` e `>`, contato, espaços. */
function limparLinha(linha: string): string {
  const base = linha
    .slice(0, LINHA_MAXIMA * 2)
    .normalize("NFC")
    .replace(CARACTERES_INVISIVEIS, "")
    .replace(CARACTERES_DE_CONTROLE, " ");
  return colapsarEspacos(removerDadosDeContato(base.replace(/[<>]/g, " ")).slice(0, LINHA_MAXIMA));
}

/** Normaliza, remove linhas vazias, curtas demais e repetidas (sem diferenciar caixa e acento). */
export function limparLinhas(linhas: string[], jaVistas: Set<string> = new Set()): string[] {
  const saida: string[] = [];
  for (const bruta of linhas) {
    const linha = limparLinha(bruta);
    if (linha.length < 2 || !/[\p{L}\p{N}]/u.test(linha)) continue;
    const chave = semAcento(linha).toLowerCase();
    if (jaVistas.has(chave)) continue;
    jaVistas.add(chave);
    saida.push(linha);
  }
  return saida;
}

/** O texto de uma página para o hash: normalização idempotente de espaços e linhas. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFC")
    .split("\n")
    .map(colapsarEspacos)
    .filter((linha) => linha !== "")
    .join("\n");
}

/** sha256 em hexadecimal do texto normalizado (a detecção de "mudou" do refeito mensal). */
export function hashDoTexto(texto: string): string {
  return createHash("sha256").update(normalizarTexto(texto), "utf8").digest("hex");
}

/** Corta em fronteira de linha (ou de palavra) para não deixar uma frase pela metade quando dá. */
export function limitarTexto(texto: string, maximo: number): { texto: string; cortado: boolean } {
  if (texto.length <= maximo) return { texto, cortado: false };
  const corte = texto.slice(0, maximo);
  const ultimaLinha = corte.lastIndexOf("\n");
  if (ultimaLinha >= maximo * 0.5)
    return { texto: corte.slice(0, ultimaLinha).trimEnd(), cortado: true };
  const ultimoEspaco = corte.lastIndexOf(" ");
  if (ultimoEspaco >= maximo * 0.8)
    return { texto: corte.slice(0, ultimoEspaco).trimEnd(), cortado: true };
  return { texto: corte.trimEnd(), cortado: true };
}

/**
 * Menu e rodapé que escaparam do walker repetem de página em página: a primeira página que
 * traz a linha fica com ela, as seguintes perdem (sem diferenciar caixa e acento).
 */
export function removerLinhasRepetidasEntrePaginas(textos: string[]): string[] {
  const vistas = new Set<string>();
  return textos.map((texto) =>
    texto
      .split("\n")
      .filter((linha) => {
        const chave = semAcento(linha).toLowerCase();
        if (vistas.has(chave)) return false;
        vistas.add(chave);
        return true;
      })
      .join("\n"),
  );
}

/**
 * Teto por página e teto total, em ordem: a home (primeira) tem prioridade. Página que
 * encontra menos de `MINIMO_RESTANTE_DO_ORCAMENTO` caracteres de orçamento volta como texto
 * vazio, e quem chama a descarta.
 */
export function aplicarTetosDeTexto(
  textos: string[],
  porPagina: number = TEXTO_MAXIMO_POR_PAGINA,
  total: number = TEXTO_MAXIMO_TOTAL,
): string[] {
  let usado = 0;
  return textos.map((texto) => {
    const restante = total - usado;
    const maximo = Math.min(porPagina, restante);
    if (restante < MINIMO_RESTANTE_DO_ORCAMENTO) return "";
    const { texto: cortado } = limitarTexto(texto, maximo);
    usado += cortado.length;
    return cortado;
  });
}

/**
 * Site sem texto aproveitável (provavelmente só carrega por JavaScript): soma abaixo de
 * `MINIMO_SOMA_CARACTERES` ou home abaixo de `MINIMO_HOME_CARACTERES`.
 */
export function textoInsuficiente(paginas: { texto: string; ehHome: boolean }[]): boolean {
  const soma = paginas.reduce((acc, pagina) => acc + pagina.texto.length, 0);
  if (soma < MINIMO_SOMA_CARACTERES) return true;
  const home = paginas.find((pagina) => pagina.ehHome);
  return home !== undefined && home.texto.length < MINIMO_HOME_CARACTERES;
}

const PADROES_DE_DESAFIO = [
  /just a moment/i,
  /attention required/i,
  /checking your browser/i,
  /verifying you are human/i,
  /verify you are human/i,
  /enable javascript and cookies to continue/i,
  /sorry, you have been blocked/i,
  /incapsula incident/i,
  /\baccess denied\b/i,
  /verificando (?:se voce|seu navegador)/i,
];

/**
 * A tela de desafio de uma proteção de bots chega com status 200 e título como "Just a
 * moment...". Resumir isso seria resumir a tela de proteção, nunca o site: texto curto que
 * casa com um dos avisos conhecidos é tratado como bloqueio.
 */
export function ehPaginaDeDesafio(titulo: string | null, texto: string): boolean {
  if (texto.length > 1_500) return false;
  const alvo = semAcento(`${titulo ?? ""}\n${texto}`);
  return PADROES_DE_DESAFIO.some((padrao) => padrao.test(alvo));
}

/* ------------------------------------------------------------------ */
/* Proteção do parser contra HTML patológico                           */
/* ------------------------------------------------------------------ */

/** Até onde o aninhamento dos elementos que aprofundam a pilha do parser pode ir. */
export const PROFUNDIDADE_MAXIMA_DO_HTML = 1_000;
/**
 * Teto de tags de bloco por página, independente de profundidade e de escopo. O parse5 confere a
 * pilha inteira a cada `<div>`, `<ul>`, `<section>` e afins (custo quadrático na profundidade: 40
 * mil `<div>` aninhados levam 7 segundos, e 200 mil, o teto de 1 MiB, uns 3 minutos com o worker
 * parado), e `<template>` aninhado estoura a pilha de chamadas. O teto de profundidade segura o
 * caso comum; este segura o resto: mesmo que a varredura erre a profundidade de uma página
 * montada de propósito (o parse5 ignora um `</div>` preso dentro de uma célula de tabela, por
 * exemplo, e a varredura não), 15 mil tags de bloco custam, no pior caso, uns 1,5 segundo. Só se
 * lê o começo de cada página (6.000 caracteres de texto), então cortar uma página de mais de 15
 * mil blocos não perde nada útil.
 */
export const MAXIMO_DE_TAGS_DE_BLOCO = 15_000;

const TAGS_QUE_APROFUNDAM = new Set([
  "div",
  "center",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "ul",
  "ol",
  "dl",
  "blockquote",
  "pre",
  "fieldset",
  "details",
  "summary",
  "dialog",
  "menu",
  "dir",
  "figure",
  "figcaption",
  "address",
  "hgroup",
  "search",
  "listing",
  "template",
  "rt",
  "rp",
  "rb",
  "rtc",
]);
/** As tags que fazem o parser conferir a pilha atrás de um `<p>` aberto: as que aprofundam e mais algumas. */
const TAGS_QUE_FECHAM_PARAGRAFO = new Set([
  ...TAGS_QUE_APROFUNDAM,
  "p",
  "li",
  "dd",
  "dt",
  "hr",
  "form",
  "table",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
const TAGS_DE_TEXTO_BRUTO = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
]);
const FECHAMENTO_DE_TEXTO_BRUTO = new Map<string, RegExp>();

function ehEspaco(codigo: number): boolean {
  return codigo === 32 || codigo === 9 || codigo === 10 || codigo === 12 || codigo === 13;
}

/**
 * Fim (`>`) da tag cujo nome terminou em `de`, lendo os atributos como o parser da web: valor
 * entre aspas pode ter `>`. Devolve -1 se a tag não fecha.
 */
function acharFimDaTag(html: string, de: number): number {
  const n = html.length;
  let k = de;
  for (;;) {
    while (k < n && (ehEspaco(html.charCodeAt(k)) || html.charCodeAt(k) === 47)) k += 1;
    if (k >= n) return -1;
    if (html.charCodeAt(k) === 62) return k;
    k += 1;
    while (k < n) {
      const c = html.charCodeAt(k);
      if (ehEspaco(c) || c === 47 || c === 62 || c === 61) break;
      k += 1;
    }
    let m = k;
    while (m < n && ehEspaco(html.charCodeAt(m))) m += 1;
    if (m < n && html.charCodeAt(m) === 61) {
      m += 1;
      while (m < n && ehEspaco(html.charCodeAt(m))) m += 1;
      if (m >= n) return -1;
      const abertura = html.charCodeAt(m);
      if (abertura === 34 || abertura === 39) {
        const fim = html.indexOf(String.fromCharCode(abertura), m + 1);
        if (fim === -1) return -1;
        k = fim + 1;
      } else {
        k = m;
        while (k < n && !ehEspaco(html.charCodeAt(k)) && html.charCodeAt(k) !== 62) k += 1;
      }
    }
  }
}

/**
 * Onde um comentário que abre em `abre` (`<!--`) termina, como o parser da web: `-->` ou `--!>`,
 * e os casos em que `<!-->` e `<!--->` já são um comentário inteiro. -1 se nunca termina.
 */
function fimDoComentario(html: string, abre: number): number {
  const inicio = abre + 4;
  if (html.charCodeAt(inicio) === 62) return inicio + 1;
  if (html.startsWith("->", inicio)) return inicio + 2;
  const normal = html.indexOf("-->", inicio);
  const comExclamacao = html.indexOf("--!>", inicio);
  if (normal === -1 && comExclamacao === -1) return -1;
  if (comExclamacao === -1 || (normal !== -1 && normal < comExclamacao)) return normal + 3;
  return comExclamacao + 4;
}

/**
 * Corta o HTML antes da tag em que o aninhamento passa de `PROFUNDIDADE_MAXIMA_DO_HTML` ou as
 * tags de bloco passam de `MAXIMO_DE_TAGS_DE_BLOCO`. Uma varredura só, linear, que conta abertura e fechamento só das
 * tags que aprofundam a pilha (as de fechamento opcional, como `p` e `li`, não entram na
 * profundidade), pula comentário e conteúdo de `script`, `style` e afins, e lê atributos como o
 * parser: assim um `<div>` dentro de um texto de script não conta, e uma aspa solta não esconde o
 * aninhamento do parser de verdade. Dentro de `<svg>` e `<math>` (conteúdo estrangeiro, onde
 * `<script>` e `<style>` são elementos comuns e um `<div>` sai de volta para o HTML) nada é pulado
 * como texto bruto. Todo erro de leitura desta varredura é para o lado de contar a mais (o pior
 * que acontece é cortar uma página esquisita), nunca a menos. Página normal passa intacta.
 */
export function limitarComplexidadeDoHtml(html: string): string {
  const n = html.length;
  let profundidade = 0;
  let blocos = 0;
  let estrangeiro = 0;
  let i = 0;
  while (i < n) {
    const abre = html.indexOf("<", i);
    if (abre === -1) break;
    if (html.startsWith("<!--", abre)) {
      const fim = fimDoComentario(html, abre);
      if (fim === -1) break;
      i = fim;
      continue;
    }
    const seguinte = html.charCodeAt(abre + 1);
    if (seguinte === 33 || seguinte === 63) {
      const fim = html.indexOf(">", abre + 2);
      if (fim === -1) break;
      i = fim + 1;
      continue;
    }
    const fechando = seguinte === 47;
    const inicioDoNome = abre + (fechando ? 2 : 1);
    const primeira = html.charCodeAt(inicioDoNome);
    const ehLetra = (primeira >= 65 && primeira <= 90) || (primeira >= 97 && primeira <= 122);
    if (!ehLetra) {
      i = abre + 1;
      continue;
    }
    let fimDoNome = inicioDoNome;
    while (fimDoNome < n) {
      const c = html.charCodeAt(fimDoNome);
      if (ehEspaco(c) || c === 47 || c === 62) break;
      fimDoNome += 1;
    }
    const nome = html.slice(inicioDoNome, fimDoNome).toLowerCase();
    const fimDaTag = acharFimDaTag(html, fimDoNome);
    if (fimDaTag === -1) break;
    i = fimDaTag + 1;

    if (fechando) {
      if (TAGS_QUE_APROFUNDAM.has(nome) && profundidade > 0) profundidade -= 1;
      if ((nome === "svg" || nome === "math") && estrangeiro > 0) estrangeiro -= 1;
      continue;
    }
    if (nome === "svg" || nome === "math") estrangeiro += 1;
    if (nome === "plaintext") break;
    if (estrangeiro === 0 && TAGS_DE_TEXTO_BRUTO.has(nome)) {
      let fechamento = FECHAMENTO_DE_TEXTO_BRUTO.get(nome);
      if (!fechamento) {
        fechamento = new RegExp(`</${nome}[\\s/>]`, "gi");
        FECHAMENTO_DE_TEXTO_BRUTO.set(nome, fechamento);
      }
      fechamento.lastIndex = i;
      const achou = fechamento.exec(html);
      if (!achou) break;
      i = achou.index;
      continue;
    }
    if (TAGS_QUE_FECHAM_PARAGRAFO.has(nome)) blocos += 1;
    if (TAGS_QUE_APROFUNDAM.has(nome)) profundidade += 1;
    if (profundidade > PROFUNDIDADE_MAXIMA_DO_HTML || blocos > MAXIMO_DE_TAGS_DE_BLOCO) {
      return html.slice(0, abre);
    }
  }
  return html;
}

/* ------------------------------------------------------------------ */
/* HTML: texto, links, meta e JSON-LD (parse5)                         */
/* ------------------------------------------------------------------ */

type No = DefaultTreeAdapterMap["node"];
type Elemento = DefaultTreeAdapterMap["element"];

export type LinkBruto = { href: string; texto: string; emNav: boolean };

export type ExtracaoHtml = {
  titulo: string | null;
  descricao: string | null;
  /** Texto final da página: meta, corpo e JSON-LD, limpo, sem repetição, sem contato. Sem tetos. */
  texto: string;
  links: LinkBruto[];
  baseHref: string | null;
  /** O corpo estruturado rendeu pouco e o texto veio de todo texto visível (e do `<noscript>`). */
  usouFallback: boolean;
};

/** O conteúdo nunca é lido (nem os links): código, estilo, molde, desenho, quadro e objeto. */
const TAGS_INTOCADAS = new Set([
  "script",
  "style",
  "template",
  "svg",
  "iframe",
  "object",
  "embed",
  "canvas",
  "math",
]);
/** O texto não entra, mas os links sim (o menu está aqui). */
const TAGS_SEM_TEXTO = new Set([
  "nav",
  "aside",
  "form",
  "button",
  "select",
  "option",
  "textarea",
  "dialog",
  "head",
]);
/** O texto só entra, no modo estruturado, de dentro destas. */
const TAGS_DE_TEXTO = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "li",
  "blockquote",
  "dt",
  "dd",
  "figcaption",
  "td",
  "th",
  "summary",
]);
const TAGS_DE_BLOCO = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "br",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "html",
  "li",
  "main",
  "nav",
  "noscript",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);
const TAGS_DE_SECAO = new Set(["article", "section", "main"]);
const PAPEIS_SEM_TEXTO = new Set([
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
  "dialog",
  "alertdialog",
]);
const PADRAO_BLOCO_DE_COOKIE =
  /cookie|consent|gdpr|lgpd|cmplz|onetrust|didomi|iubenda|trustarc|cookiebot/i;

type Contexto = {
  coletar: boolean;
  estruturado: boolean;
  noscript: boolean;
  secao: boolean;
  nav: boolean;
  link: LinkBruto | null;
};

type ItemDaPilha = { no: No; contexto: Contexto } | { fimDeBloco: true };

function atributo(elemento: Elemento, nome: string): string | undefined {
  return elemento.attrs.find((atributoAtual) => atributoAtual.name === nome)?.value;
}

function textoDe(no: No): string {
  let texto = "";
  if ("childNodes" in no) {
    for (const filho of no.childNodes) {
      if (filho.nodeName === "#text" && "value" in filho) texto += filho.value;
    }
  }
  return texto;
}

function estaEscondido(elemento: Elemento): boolean {
  if (atributo(elemento, "hidden") !== undefined) return true;
  if (atributo(elemento, "aria-hidden")?.toLowerCase() === "true") return true;
  const estilo = atributo(elemento, "style");
  if (estilo && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(estilo)) return true;
  const papel = atributo(elemento, "role")?.toLowerCase();
  if (papel && PAPEIS_SEM_TEXTO.has(papel)) return true;
  return atributo(elemento, "aria-modal")?.toLowerCase() === "true";
}

/** Conta caracteres de texto de uma subárvore, parando em `limite` (sem recursão profunda). */
function textoCurto(raiz: No, limite: number): boolean {
  let total = 0;
  const pilha: No[] = [raiz];
  while (pilha.length > 0) {
    const no = pilha.pop() as No;
    if (no.nodeName === "#text" && "value" in no) {
      total += no.value.trim().length;
      if (total > limite) return false;
    } else if ("tagName" in no && TAGS_INTOCADAS.has(no.tagName)) {
      continue;
    } else if ("childNodes" in no) {
      for (const filho of no.childNodes) pilha.push(filho);
    }
  }
  return true;
}

function ehBlocoDeCookie(elemento: Elemento): boolean {
  if (elemento.tagName === "html" || elemento.tagName === "body" || elemento.tagName === "main")
    return false;
  const classe = atributo(elemento, "class") ?? "";
  const id = atributo(elemento, "id") ?? "";
  if (!PADRAO_BLOCO_DE_COOKIE.test(classe) && !PADRAO_BLOCO_DE_COOKIE.test(id)) return false;
  /** Uma classe como "has-cookie-banner" no contêiner da página inteira não pode esconder a página: só texto curto conta. */
  return textoCurto(elemento, TEXTO_CURTO_DO_BLOCO_DE_COOKIE);
}

const TIPOS_DE_JSON_LD = new Set(
  [
    "Organization",
    "Corporation",
    "NGO",
    "LocalBusiness",
    "OnlineStore",
    "OnlineBusiness",
    "Store",
    "Product",
    "ProductGroup",
    "Service",
    "FAQPage",
    "Dentist",
    "MedicalBusiness",
    "MedicalClinic",
    "Physician",
    "Restaurant",
    "FoodEstablishment",
    "CafeOrCoffeeShop",
    "Bakery",
    "BarOrPub",
    "HealthAndBeautyBusiness",
    "BeautySalon",
    "HairSalon",
    "DaySpa",
    "HealthClub",
    "GymOrFitnessCenter",
    "ProfessionalService",
    "LegalService",
    "Attorney",
    "AccountingService",
    "RealEstateAgent",
    "AutoRepair",
    "AutoDealer",
    "HomeAndConstructionBusiness",
    "Electrician",
    "Plumber",
    "GeneralContractor",
    "ChildCare",
    "EducationalOrganization",
    "School",
    "LodgingBusiness",
    "Hotel",
    "TravelAgency",
    "Florist",
    "PetStore",
    "Pharmacy",
    "Optician",
  ].map((tipo) => tipo.toLowerCase()),
);

/** Campos de texto livre lidos de um item do JSON-LD. Telefone, e-mail, endereço, fax e links nunca entram. */
const CAMPOS_DE_TEXTO_JSON_LD = [
  "name",
  "legalName",
  "alternateName",
  "description",
  "slogan",
  "category",
  "serviceType",
  "knowsAbout",
  "keywords",
  "areaServed",
  "brand",
  "provider",
];

const JSON_LD_NOS_MAXIMOS = 400;
const JSON_LD_PROFUNDIDADE_MAXIMA = 6;
const JSON_LD_BLOCOS_MAXIMOS = 8;
const JSON_LD_BLOCO_MAXIMO_CARACTERES = 200_000;

function textoDeJsonLd(valor: unknown): string[] {
  if (typeof valor === "string") {
    const limpo = colapsarEspacos(valor.replace(/<[^>]*>/g, " ")).slice(0, 600);
    return limpo ? [limpo] : [];
  }
  if (Array.isArray(valor)) return valor.slice(0, 20).flatMap(textoDeJsonLd);
  if (valor && typeof valor === "object" && "name" in valor)
    return textoDeJsonLd((valor as { name: unknown }).name);
  return [];
}

function tiposDe(item: Record<string, unknown>): string[] {
  const tipo = item["@type"];
  const lista = Array.isArray(tipo) ? tipo : [tipo];
  return lista
    .filter((valor): valor is string => typeof valor === "string")
    .map((valor) => valor.toLowerCase());
}

/** Lê só campos de texto de itens de tipos conhecidos, em qualquer profundidade razoável do grafo. */
function coletarJsonLd(raiz: unknown, saida: string[]): void {
  let visitados = 0;
  const visitar = (valor: unknown, profundidade: number, relevante: boolean): void => {
    if (visitados >= JSON_LD_NOS_MAXIMOS || profundidade > JSON_LD_PROFUNDIDADE_MAXIMA) return;
    if (Array.isArray(valor)) {
      for (const item of valor.slice(0, 50)) visitar(item, profundidade + 1, relevante);
      return;
    }
    if (!valor || typeof valor !== "object") return;
    visitados += 1;
    const item = valor as Record<string, unknown>;
    const tipos = tiposDe(item);
    const ehRelevante = relevante || tipos.some((tipo) => TIPOS_DE_JSON_LD.has(tipo));

    if (item["@graph"]) visitar(item["@graph"], profundidade + 1, relevante);
    if (!ehRelevante) return;

    for (const campo of CAMPOS_DE_TEXTO_JSON_LD) saida.push(...textoDeJsonLd(item[campo]));

    /** Pergunta e resposta de FAQ, no mesmo formato de uma frase só. */
    if (tipos.includes("question")) {
      const resposta = item["acceptedAnswer"];
      const textoDaResposta =
        resposta && typeof resposta === "object"
          ? textoDeJsonLd((resposta as { text?: unknown }).text)
          : [];
      const pergunta = textoDeJsonLd(item["name"]);
      if (pergunta.length > 0 && textoDaResposta.length > 0)
        saida.push(`${pergunta[0]} ${textoDaResposta[0]}`);
    }

    for (const campo of [
      "mainEntity",
      "offers",
      "hasOfferCatalog",
      "itemListElement",
      "itemOffered",
      "makesOffer",
    ]) {
      if (item[campo]) visitar(item[campo], profundidade + 1, true);
    }
  };
  visitar(raiz, 0, false);
}

/** Linhas de texto dos blocos JSON-LD (já com o JSON lido; bloco inválido é ignorado). */
export function extrairLinhasDeJsonLd(blocos: string[]): string[] {
  const saida: string[] = [];
  for (const bloco of blocos.slice(0, JSON_LD_BLOCOS_MAXIMOS)) {
    if (bloco.length > JSON_LD_BLOCO_MAXIMO_CARACTERES) continue;
    try {
      coletarJsonLd(JSON.parse(bloco) as unknown, saida);
    } catch {
      continue;
    }
  }
  return saida;
}

/**
 * Lê o HTML com o parse5 (parser puro: não executa script, não carrega recurso) e devolve
 * texto, links, título e descrição. O walker é iterativo, para uma página com aninhamento
 * absurdo não estourar a pilha de chamadas.
 *
 * Texto: título, descrição e `og:*` da meta; do corpo, só o que está em h1 a h4, p, li e
 * afins, pulando código, estilo, menu (`nav`, `header` e `footer` soltos, `aside`), formulário,
 * escondido, janela, aviso de cookie e consentimento. Se isso render menos de 200 caracteres
 * (página montada com `div`, ou de página única com `<noscript>`), recorre a todo o texto
 * visível mais o `<noscript>`. Do JSON-LD entram só campos de texto de tipos conhecidos.
 * E-mail e telefone saem do texto.
 */
export function extrairDoHtml(html: string): ExtracaoHtml {
  let documento: DefaultTreeAdapterMap["document"];
  try {
    documento = parse(limitarComplexidadeDoHtml(html), { scriptingEnabled: false });
  } catch (erro) {
    /** Pilha de chamadas estourada dentro do parser (HTML patológico que passou da varredura): sem texto, não é erro nosso. */
    if (erro instanceof RangeError) {
      return {
        titulo: null,
        descricao: null,
        texto: "",
        links: [],
        baseHref: null,
        usouFallback: false,
      };
    }
    throw erro;
  }

  let titulo: string | null = null;
  let baseHref: string | null = null;
  const metas: Record<string, string> = {};
  const blocosJsonLd: string[] = [];
  const links: LinkBruto[] = [];

  const linhasEstruturadas: string[] = [];
  const linhasGerais: string[] = [];
  const linhasNoscript: string[] = [];
  let bufferEstruturado = "";
  let bufferGeral = "";
  let bufferNoscript = "";
  let coletados = 0;

  const descarregar = (): void => {
    if (bufferEstruturado.trim() && coletados < COLETA_MAXIMA_CARACTERES) {
      linhasEstruturadas.push(bufferEstruturado);
      coletados += bufferEstruturado.length;
    }
    if (bufferGeral.trim() && coletados < COLETA_MAXIMA_CARACTERES * 2)
      linhasGerais.push(bufferGeral);
    if (bufferNoscript.trim() && coletados < COLETA_MAXIMA_CARACTERES * 2)
      linhasNoscript.push(bufferNoscript);
    bufferEstruturado = "";
    bufferGeral = "";
    bufferNoscript = "";
  };

  const contextoInicial: Contexto = {
    coletar: true,
    estruturado: false,
    noscript: false,
    secao: false,
    nav: false,
    link: null,
  };
  const pilha: ItemDaPilha[] = [{ no: documento, contexto: contextoInicial }];

  while (pilha.length > 0) {
    const item = pilha.pop() as ItemDaPilha;
    if ("fimDeBloco" in item) {
      descarregar();
      continue;
    }
    const { no, contexto } = item;

    if (no.nodeName === "#text" && "value" in no) {
      const valor = no.value.replace(/\s+/g, " ");
      if (contexto.link && contexto.link.texto.length < 200) contexto.link.texto += valor;
      if (contexto.coletar) {
        if (contexto.noscript) {
          bufferNoscript += valor;
        } else {
          bufferGeral += valor;
          if (contexto.estruturado) bufferEstruturado += valor;
        }
      }
      continue;
    }

    if (!("tagName" in no)) {
      if ("childNodes" in no) {
        for (let i = no.childNodes.length - 1; i >= 0; i -= 1)
          pilha.push({ no: no.childNodes[i], contexto });
      }
      continue;
    }

    const tag = no.tagName;

    if (tag === "script") {
      const tipo = atributo(no, "type")?.toLowerCase() ?? "";
      if (tipo.includes("ld+json") && blocosJsonLd.length < JSON_LD_BLOCOS_MAXIMOS)
        blocosJsonLd.push(textoDe(no));
      continue;
    }
    if (TAGS_INTOCADAS.has(tag)) continue;

    if (tag === "title") {
      if (titulo === null) titulo = colapsarEspacos(textoDe(no)) || null;
      continue;
    }
    if (tag === "meta") {
      const chave = (atributo(no, "property") ?? atributo(no, "name") ?? "").toLowerCase();
      const conteudo = atributo(no, "content");
      if (chave && conteudo && !(chave in metas)) metas[chave] = conteudo;
      continue;
    }
    if (tag === "base") {
      if (baseHref === null) baseHref = atributo(no, "href") ?? null;
      continue;
    }

    let coletar = contexto.coletar;
    if (coletar) {
      if (TAGS_SEM_TEXTO.has(tag)) coletar = false;
      else if ((tag === "header" || tag === "footer") && !contexto.secao) coletar = false;
      else if (estaEscondido(no)) coletar = false;
      else if (ehBlocoDeCookie(no)) coletar = false;
    }

    const papel = atributo(no, "role")?.toLowerCase();
    const contextoFilho: Contexto = {
      coletar,
      estruturado: contexto.estruturado || TAGS_DE_TEXTO.has(tag),
      noscript: contexto.noscript || tag === "noscript",
      secao: contexto.secao || TAGS_DE_SECAO.has(tag),
      nav: contexto.nav || tag === "nav" || papel === "navigation",
      link: contexto.link,
    };

    if (tag === "a" && !contexto.noscript) {
      const href = atributo(no, "href");
      if (href && links.length < LINKS_BRUTOS_MAXIMOS) {
        const link: LinkBruto = { href, texto: "", emNav: contextoFilho.nav };
        links.push(link);
        contextoFilho.link = link;
      }
    }

    const ehBloco = TAGS_DE_BLOCO.has(tag);
    if (tag === "br") {
      descarregar();
      continue;
    }
    if (ehBloco) {
      descarregar();
      pilha.push({ fimDeBloco: true });
    }
    for (let i = no.childNodes.length - 1; i >= 0; i -= 1)
      pilha.push({ no: no.childNodes[i], contexto: contextoFilho });
  }
  descarregar();

  const tituloDaMeta = metas["og:title"] ?? null;
  const descricao = colapsarEspacos(metas["description"] ?? metas["og:description"] ?? "") || null;
  const tituloFinal = titulo ?? (tituloDaMeta ? colapsarEspacos(tituloDaMeta) || null : null);

  const linhasMeta = [
    titulo,
    metas["og:site_name"],
    metas["description"],
    metas["og:title"],
    metas["og:description"],
  ].filter((linha): linha is string => typeof linha === "string");
  const linhasDeJsonLd = extrairLinhasDeJsonLd(blocosJsonLd);

  const corpoEstruturado = limparLinhas(linhasEstruturadas);
  const tamanhoEstruturado = corpoEstruturado.reduce((acc, linha) => acc + linha.length, 0);
  const usouFallback = tamanhoEstruturado < MINIMO_ANTES_DO_FALLBACK;
  const corpo = usouFallback ? [...linhasGerais, ...linhasNoscript] : corpoEstruturado;

  const texto = limparLinhas([...linhasMeta, ...corpo, ...linhasDeJsonLd]).join("\n");

  return {
    titulo: tituloFinal ? limparLinha(tituloFinal).slice(0, TITULO_MAXIMO) || null : null,
    descricao: descricao ? limparLinha(descricao).slice(0, DESCRICAO_MAXIMA) || null : null,
    texto,
    links,
    baseHref,
    usouFallback,
  };
}

/* ------------------------------------------------------------------ */
/* Links: quais páginas ler                                            */
/* ------------------------------------------------------------------ */

export type CategoriaDePagina = "sobre" | "produtos" | "extra";

export type Candidato = { url: string; categoria: CategoriaDePagina; pontos: number };

/** Home, 1 de sobre, até 2 de produtos ou serviços e 1 curinga (contato, FAQ ou depoimentos). */
export const ORCAMENTO_DE_PAGINAS: Record<CategoriaDePagina, number> = {
  sobre: 1,
  produtos: 2,
  extra: 1,
};

const PALAVRAS: Record<CategoriaDePagina, string[]> = {
  sobre: [
    "sobre",
    "quem-somos",
    "nossa-historia",
    "institucional",
    "about",
    "about-us",
    "nosotros",
    "quienes-somos",
    "empresa",
    "historia",
    "equipe",
  ],
  produtos: [
    "produto",
    "servico",
    "solucoes",
    "solucao",
    "loja",
    "catalogo",
    "cardapio",
    "tratamento",
    "especialidade",
    "procedimento",
    "curso",
    "plano",
    "preco",
    "portfolio",
    "atuacao",
    "product",
    "service",
    "shop",
    "menu",
    "tienda",
    "producto",
    "servicio",
    "precios",
    "tratamiento",
  ],
  extra: [
    "contato",
    "contact",
    "contacto",
    "fale-conosco",
    "faq",
    "perguntas-frequentes",
    "duvidas",
    "depoimento",
    "testimonial",
    "testimonio",
    "avaliacoes",
    "review",
    "opinioes",
  ],
};

const SEGMENTOS_DESCARTADOS = new Set([
  "login",
  "logout",
  "signin",
  "signup",
  "entrar",
  "carrinho",
  "cart",
  "checkout",
  "privacidade",
  "privacy",
  "termos",
  "terms",
  "cookies",
  "lgpd",
  "wishlist",
  "search",
  "busca",
  "buscar",
  "feed",
  "rss",
  "wp-admin",
  "wp-json",
  "wp-content",
  "wp-includes",
  "wp-login.php",
  "xmlrpc.php",
  "cdn-cgi",
]);
const FRASES_DESCARTADAS = ["minha-conta", "my-account", "finalizar-compra"];
const SEGMENTOS_DE_BLOG = new Set([
  "blog",
  "noticias",
  "news",
  "artigos",
  "categoria",
  "category",
  "tag",
]);
const EXTENSAO_DE_ARQUIVO =
  /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|bmp|avif|mp4|mov|avi|webm|mkv|mp3|wav|ogg|zip|rar|7z|gz|tar|docx?|xlsx?|pptx?|csv|css|js|mjs|json|xml|txt|woff2?|ttf|eot|apk|exe|dmg)$/i;
const PARAMETROS_DE_RASTREIO =
  /^(?:utm_.*|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|_ga|_gl|ref)$/i;

function tokensDe(texto: string): string[] {
  return semAcento(texto)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function contemPalavra(tokens: string[], palavras: string[]): boolean {
  if (tokens.length === 0) return false;
  const juntos = `-${tokens.join("-")}-`;
  return palavras.some((palavra) => {
    if (palavra.includes("-")) return juntos.includes(`-${palavra}-`);
    return tokens.some(
      (token) => token === palavra || token === `${palavra}s` || token === `${palavra}es`,
    );
  });
}

/**
 * Resolve, limpa e valida um link da página. Devolve `null` para tudo que não é uma página
 * do mesmo site: outro host (subdomínio irmão, como "loja.", fica de fora), `mailto:`,
 * `tel:`, `javascript:`, âncora, arquivo, IP, rastreio e áreas que não ajudam (login, carrinho,
 * privacidade, termos, administração, feed). `http` do mesmo site sobe para `https`.
 */
export function normalizarLink(href: string, base: URL, hostPermitido: string): URL | null {
  const bruto = href.trim();
  if (bruto === "" || bruto.startsWith("#")) return null;
  let url: URL;
  try {
    url = new URL(bruto, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (!mesmoSite(url.hostname, hostPermitido)) return null;
  if (isIP(semColchetes(url.hostname)) !== 0) return null;
  if (url.protocol === "http:") {
    if (url.port !== "") return null;
    url.protocol = "https:";
  }
  if (url.port !== "") return null;

  url.hostname = hostPermitido;
  url.hash = "";
  for (const chave of [...url.searchParams.keys()]) {
    if (PARAMETROS_DE_RASTREIO.test(chave)) url.searchParams.delete(chave);
  }

  const caminho = url.pathname.replace(/\/{2,}/g, "/");
  if (EXTENSAO_DE_ARQUIVO.test(caminho)) return null;
  const segmentos = caminho
    .split("/")
    .filter(Boolean)
    .map((segmento) => segmento.toLowerCase());
  if (segmentos.some((segmento) => SEGMENTOS_DESCARTADOS.has(segmento))) return null;
  const tokensDoCaminho = segmentos.flatMap(tokensDe);
  if (tokensDoCaminho.some((token) => SEGMENTOS_DESCARTADOS.has(token))) return null;
  const juntos = `-${tokensDoCaminho.join("-")}-`;
  if (FRASES_DESCARTADAS.some((frase) => juntos.includes(`-${frase}-`))) return null;

  url.pathname = caminho.length > 1 ? caminho.replace(/\/$/, "") : caminho;
  return url;
}

function chaveDaUrl(url: URL): string {
  return `${url.pathname}${url.search}`;
}

/**
 * Pontua um caminho (e o texto do link) contra as três categorias. Peso forte para a palavra
 * no caminho, médio para a palavra no texto do link, bônus por estar no menu; penalidade por
 * profundidade acima de 2, por query string e por ser artigo de blog.
 */
function pontuar(
  url: URL,
  texto: string,
  emNav: boolean,
): { categoria: CategoriaDePagina; pontos: number } | null {
  const segmentos = url.pathname.split("/").filter(Boolean);
  const tokensDoCaminho = segmentos.flatMap(tokensDe);
  const tokensDoTexto = tokensDe(texto);

  let melhor: { categoria: CategoriaDePagina; base: number } | null = null;
  for (const categoria of ["sobre", "produtos", "extra"] as const) {
    const noCaminho = contemPalavra(tokensDoCaminho, PALAVRAS[categoria]) ? 10 : 0;
    const noTexto = contemPalavra(tokensDoTexto, PALAVRAS[categoria]) ? 5 : 0;
    const base = noCaminho + noTexto;
    if (base > 0 && (melhor === null || base > melhor.base)) melhor = { categoria, base };
  }
  if (melhor === null) return null;

  let pontos = melhor.base;
  if (emNav) pontos += 2;
  pontos -= Math.max(0, segmentos.length - 2) * 2;
  if (url.search !== "") pontos -= 3;
  if (segmentos.some((segmento) => SEGMENTOS_DE_BLOG.has(segmento.toLowerCase()))) pontos -= 6;
  return { categoria: melhor.categoria, pontos };
}

/**
 * Todos os candidatos a leitura, do mais forte ao mais fraco: resolve cada link contra a
 * página (e o `<base href>`, se for do mesmo site), descarta o que não serve, junta
 * duplicatas (fica a melhor pontuação) e exclui a própria página. Considera no máximo
 * `LINKS_CANDIDATOS_MAXIMOS`. Serve para links do HTML e para os `<loc>` do sitemap.
 */
export function classificarCandidatos(
  links: LinkBruto[],
  paginaUrl: URL,
  baseHref: string | null,
  hostPermitido: string,
): Candidato[] {
  let base = paginaUrl;
  if (baseHref) {
    try {
      const candidata = new URL(baseHref, paginaUrl);
      if (candidata.protocol === "https:" && mesmoSite(candidata.hostname, hostPermitido))
        base = candidata;
    } catch {
      /* <base> invalido: usa a propria pagina */
    }
  }

  const propria = normalizarLink(paginaUrl.href, paginaUrl, hostPermitido);
  const chavePropria = propria ? chaveDaUrl(propria) : null;
  const porChave = new Map<string, Candidato>();

  for (const link of links) {
    const url = normalizarLink(link.href, base, hostPermitido);
    if (!url) continue;
    const chave = chaveDaUrl(url);
    if (chave === chavePropria || chave === "/") continue;
    const pontuacao = pontuar(url, link.texto, link.emNav);
    if (!pontuacao) continue;
    const atual = porChave.get(chave);
    if (!atual || pontuacao.pontos > atual.pontos) {
      porChave.set(chave, {
        url: url.href,
        categoria: pontuacao.categoria,
        pontos: pontuacao.pontos,
      });
    }
  }

  return [...porChave.values()]
    .sort(
      (a, b) => b.pontos - a.pontos || a.url.length - b.url.length || a.url.localeCompare(b.url),
    )
    .slice(0, LINKS_CANDIDATOS_MAXIMOS);
}

/**
 * Escolhe as páginas pelo orçamento (sem passar vaga de uma categoria para outra: com
 * menos candidatos, lê menos). `aceita` deixa quem chama recusar um candidato (por exemplo,
 * proibido no robots.txt) e cair no próximo da mesma categoria. Ordem da leitura: sobre,
 * produtos, curinga.
 */
export function selecionarPorOrcamento(
  candidatos: Candidato[],
  orcamento: Record<CategoriaDePagina, number> = ORCAMENTO_DE_PAGINAS,
  aceita: (candidato: Candidato) => boolean = () => true,
): Candidato[] {
  const escolhidos: Candidato[] = [];
  for (const categoria of ["sobre", "produtos", "extra"] as const) {
    let vagas = orcamento[categoria];
    for (const candidato of candidatos) {
      if (vagas <= 0) break;
      if (candidato.categoria !== categoria || !aceita(candidato)) continue;
      escolhidos.push(candidato);
      vagas -= 1;
    }
  }
  return escolhidos;
}

/* ------------------------------------------------------------------ */
/* robots.txt (RFC 9309)                                               */
/* ------------------------------------------------------------------ */

export type RegrasRobots = {
  /** Endereços de sitemap declarados (`Sitemap:`), sem filtro de host. */
  sitemaps: string[];
  /** `caminho` é o caminho com a query (`/pasta?x=1`). */
  permite: (caminho: string) => boolean;
};

type RegraDeRobots = { permitir: boolean; padrao: string; ancorado: boolean };

const ROBOTS_REGRAS_MAXIMAS = 5_000;
const ROBOTS_PADRAO_MAXIMO = 1_024;
const ROBOTS_SITEMAPS_MAXIMOS = 20;

/** Escapes de porcentagem de caractere livre viram o caractere; os outros ficam em maiúscula; não ASCII é codificado. */
function normalizarCaminhoDeRobots(texto: string): string {
  const codificado = texto.replace(/[^\u0000-\u007F]+/g, (trecho) => {
    try {
      return encodeURIComponent(trecho);
    } catch {
      return "";
    }
  });
  return codificado.replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) => {
    const caractere = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(caractere) ? caractere : `%${hex.toUpperCase()}`;
  });
}

/** Casamento de prefixo com curinga `*` (e fim `$` já tirado, vira `ancorado`), em tempo O(n*m) sem retrocesso explosivo. */
function casaPadrao(padrao: string, caminho: string, ancorado: boolean): boolean {
  let p = 0;
  let c = 0;
  let estrela = -1;
  let marca = 0;
  while (c < caminho.length) {
    if (p < padrao.length && padrao[p] === "*") {
      estrela = p;
      p += 1;
      marca = c;
    } else if (p < padrao.length && padrao[p] === caminho[c]) {
      p += 1;
      c += 1;
    } else if (p === padrao.length && !ancorado) {
      return true;
    } else if (estrela !== -1) {
      p = estrela + 1;
      marca += 1;
      c = marca;
    } else {
      return false;
    }
  }
  while (p < padrao.length && padrao[p] === "*") p += 1;
  return p === padrao.length;
}

/**
 * Lê um robots.txt para o nosso agente. Grupos por `User-agent` (linhas seguidas formam um
 * grupo); o grupo que cita o nosso token (igual ou começando por ele e hífen) vale no lugar
 * do `*`; `Allow` e `Disallow` por maior correspondência (empate fica com `Allow`); `*` e
 * `$` nos padrões; `Allow` ou `Disallow` vazio não faz nada; `/robots.txt` é sempre
 * permitido. Sem grupo que se aplique, tudo é permitido.
 */
export function analisarRobots(texto: string, tokenDoAgente: string): RegrasRobots {
  const token = tokenDoAgente.toLowerCase();
  const grupos: { agentes: string[]; regras: RegraDeRobots[] }[] = [];
  const sitemaps: string[] = [];
  let atual: { agentes: string[]; regras: RegraDeRobots[] } | null = null;
  let ultimaFoiAgente = false;
  let totalDeRegras = 0;

  for (const linhaCrua of texto.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    const comentario = linhaCrua.indexOf("#");
    const linha = (comentario === -1 ? linhaCrua : linhaCrua.slice(0, comentario)).trim();
    const doisPontos = linha.indexOf(":");
    if (doisPontos === -1) continue;
    const chave = linha.slice(0, doisPontos).trim().toLowerCase();
    const valor = linha.slice(doisPontos + 1).trim();

    if (chave === "user-agent") {
      if (!atual || !ultimaFoiAgente) {
        atual = { agentes: [], regras: [] };
        grupos.push(atual);
      }
      atual.agentes.push(valor.toLowerCase());
      ultimaFoiAgente = true;
    } else if (chave === "allow" || chave === "disallow") {
      if (!atual) continue;
      ultimaFoiAgente = false;
      if (valor === "" || totalDeRegras >= ROBOTS_REGRAS_MAXIMAS) continue;
      const ancorado = valor.endsWith("$");
      const padrao = normalizarCaminhoDeRobots(ancorado ? valor.slice(0, -1) : valor).slice(
        0,
        ROBOTS_PADRAO_MAXIMO,
      );
      atual.regras.push({ permitir: chave === "allow", padrao, ancorado });
      totalDeRegras += 1;
    } else if (chave === "sitemap") {
      if (valor && sitemaps.length < ROBOTS_SITEMAPS_MAXIMOS) sitemaps.push(valor);
    }
  }

  const cita = (agente: string) =>
    agente !== "*" && agente !== "" && (token === agente || token.startsWith(`${agente}-`));
  const especificos = grupos.filter((grupo) => grupo.agentes.some(cita));
  const aplicaveis =
    especificos.length > 0 ? especificos : grupos.filter((grupo) => grupo.agentes.includes("*"));
  const regras = aplicaveis.flatMap((grupo) => grupo.regras);

  return {
    sitemaps,
    permite(caminho: string): boolean {
      const alvo = normalizarCaminhoDeRobots(caminho.slice(0, 2_048));
      if (alvo === "/robots.txt" || alvo.startsWith("/robots.txt?")) return true;
      let melhor: { tamanho: number; permitir: boolean } | null = null;
      for (const regra of regras) {
        if (!casaPadrao(regra.padrao, alvo, regra.ancorado)) continue;
        const tamanho = regra.padrao.length;
        if (
          melhor === null ||
          tamanho > melhor.tamanho ||
          (tamanho === melhor.tamanho && regra.permitir && !melhor.permitir)
        ) {
          melhor = { tamanho, permitir: regra.permitir };
        }
      }
      return melhor ? melhor.permitir : true;
    },
  };
}

/** Sem robots.txt (404 e afins): tudo permitido. */
export function robotsPermiteTudo(): RegrasRobots {
  return { sitemaps: [], permite: () => true };
}

/* ------------------------------------------------------------------ */
/* sitemap.xml                                                         */
/* ------------------------------------------------------------------ */

const SITEMAP_LOCS_MAXIMOS = 5_000;

function decodificarEntidadesXml(texto: string): string {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Os `<loc>` de um `sitemap.xml` ou de um índice de sitemaps (`<sitemapindex>`). Busca por
 * posição, sem regex com varredura longa, porque o XML vem de terceiros e chega a 1 MiB.
 */
export function extrairLocsDeSitemap(xml: string): { urls: string[]; ehIndice: boolean } {
  const ehIndice = /<sitemapindex[\s>]/.test(xml);
  const urls: string[] = [];
  let posicao = 0;
  while (urls.length < SITEMAP_LOCS_MAXIMOS) {
    const abre = xml.indexOf("<loc>", posicao);
    if (abre === -1) break;
    const inicio = abre + "<loc>".length;
    const fecha = xml.indexOf("</loc>", inicio);
    if (fecha === -1) break;
    let conteudo = xml.slice(inicio, fecha).trim();
    if (conteudo.startsWith("<![CDATA[") && conteudo.endsWith("]]>"))
      conteudo = conteudo.slice(9, -3).trim();
    else conteudo = decodificarEntidadesXml(conteudo);
    if (conteudo) urls.push(conteudo);
    posicao = fecha + "</loc>".length;
  }
  return { urls, ehIndice };
}

/** De um índice de sitemaps, o filho que mais parece listar páginas (e não artigos, produtos ou imagens). */
export function escolherSitemapFilho(urls: string[]): string | null {
  if (urls.length === 0) return null;
  const ponto = (url: string): number => {
    const tokens = tokensDe(url.toLowerCase());
    if (
      tokens.some(
        (token) =>
          token === "page" || token === "pages" || token === "pagina" || token === "paginas",
      )
    )
      return 3;
    if (
      tokens.some(
        (token) =>
          token === "post" ||
          token === "posts" ||
          token === "blog" ||
          token === "category" ||
          token === "tag",
      )
    )
      return -2;
    if (
      tokens.some(
        (token) => token === "image" || token === "images" || token === "video" || token === "news",
      )
    )
      return -3;
    return 0;
  };
  return [...urls].sort((a, b) => ponto(b) - ponto(a))[0];
}
