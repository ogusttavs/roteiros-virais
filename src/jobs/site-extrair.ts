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
 * A terceira decisão é o CUSTO. Tudo o que entra aqui é de terceiros e o worker é um processo só
 * (o pg-boss e todos os jobs param junto), então nenhuma função pode ser quadrática num texto que o
 * dono do site escolhe. Os limites e a razão de cada um estão junto do código: HTML ("Por que
 * existe esta seção", mais abaixo), JSON-LD (`textoDeJsonLd`), robots.txt (`ROBOTS_*`), nós
 * visitados por conferência (`NOS_POR_CONFERENCIA` e `NOS_POR_PAGINA`), links (`HREF_MAXIMO`) e
 * sitemap (`SITEMAP_*`). Auditoria dos `replace`, `match`, `test`, `split`, `exec` e `matchAll`
 * sobre texto de terceiros neste arquivo e em `site-api.ts` (a revisão achou dois regex
 * quadráticos, o do JSON-LD e o do robots.txt, e um `indexOf` repetido, o do fim de comentário):
 * - O texto já vem FATIADO antes do regex: a linha de texto (3.000 caracteres, em `limparLinha`),
 *   o valor de JSON-LD (2.000), o `Content-Type` (1.024), o `style` (2.000), `class` e `id` do aviso
 *   de cookie (2.000 e 200), a linha de regra do robots.txt (1.024, e o padrão 200), o caminho
 *   perguntado ao robots.txt (2.048 e depois 512), o `<loc>` do sitemap (2.048), o endereço de um
 *   link (2.048), o começo do XML onde mora o `<sitemapindex>` (50.000) e o `<meta charset>` (os 1.024
 *   primeiros bytes).
 * - Linear por construção, sem quantificador aninhado nem alternância que se sobreponha: o e-mail
 *   (o lookbehind faz a busca só começar no início de cada trecho), os telefones (todo quantificador
 *   é limitado, menos a sequência de separadores depois do rótulo, que cada rótulo consome uma
 *   vez), os caracteres invisíveis e de controle (classes), `colapsarEspacos`, `semAcento`, os
 *   `split` por quebra de linha, por `-`, `_`, `/` e espaço, o fechamento de texto bruto (literal,
 *   procurado a partir do ponto em que o elemento abriu, cada trecho lido uma vez), a limpeza de
 *   tags do JSON-LD (a classe não aceita `<`, então a busca de cada `<` nunca passa de outro `<`) e
 *   o decodificador de entidades do sitemap.
 * - Sem regex: o fim de comentário, o fim de tag, o `<loc>` do sitemap, o casamento do robots.txt
 *   (`indexOf` e `startsWith` entre curingas) e o `.gz` do sitemap (`endsWith`).
 * - Só entrada nossa (não é de terceiros): `soAscii` e o nome do app em `site-api.ts`, o token do
 *   agente passado por quem chama.
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
/** Quanto texto um formulário ou cabeçalho pode ter para ainda valer como "só interface" (e não como a página inteira). */
const TEXTO_CURTO_DO_FORMULARIO = 1_500;
const TITULO_MAXIMO = 200;
const DESCRICAO_MAXIMA = 400;
/** Nós que uma conferência de "texto curto" (aviso de cookie, formulário, cabeçalho) pode visitar. */
const NOS_POR_CONFERENCIA = 2_000;
/** Nós que todas as conferências juntas podem visitar em uma página (estourou: nenhuma tira mais texto). */
const NOS_POR_PAGINA = 60_000;
/** Maior endereço de link que o leitor considera (acima disso é lixo, e custaria regex e URL à toa). */
const HREF_MAXIMO = 2_048;

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
  /** Fatiado antes do regex: o cabeçalho é de terceiros (o undici já limita, mas não dependemos disso). */
  const achado = /charset\s*=\s*"?([^";\s,]+)/i.exec(contentType.slice(0, 1_024));
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

/**
 * Caracteres que a pessoa não vê e o modelo lê: espaços de largura zero e marcas de direção, hífen
 * suave, junção de grafemas (U+034F), marca de letra árabe (U+061C), separador mongol (U+180E),
 * preenchimentos de hangul (U+3164, U+FFA0), braile em branco (U+2800), seletores de variação
 * (U+FE00 a U+FE0F e U+E0100 a U+E01EF) e os "tag characters" (U+E0000 a U+E007F), que escondem
 * ASCII dentro de um texto aparentemente vazio (injeção de instrução invisível). Flag `u`.
 */
const CARACTERES_INVISIVEIS =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD\u034F\u061C\u180E\u2800\u3164\uFFA0\uFE00-\uFE0F\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
/** Controles C0 (menos tab, quebra de linha e retorno) e C1; viram espaço. */
const CARACTERES_DE_CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/**
 * E-mail, inclusive com letra acentuada. O lookbehind faz a busca começar só no início de cada
 * trecho de caracteres de e-mail, e não em cada letra dele (sem isso, um trecho longo sem
 * arroba custa O(n²)).
 */
const PADRAO_EMAIL =
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
/** Dois anos colados ("2024-2025", "2019 2020"): nunca é telefone. */
const DOIS_ANOS = String.raw`(?:19|20)\d{2}[\s.-]?(?:19|20)\d{2}(?!\d)`;
const PADRAO_TELEFONE_INTERNACIONAL = /\+\s?\d[\d\s().-]{7,20}\d/g;
/**
 * Brasileiro com DDD: "(11) 91234-5678", "11 91234 5678", "11-91234-5678", "11.91234.5678",
 * "11912345678". Dois anos depois do DDD ("12 2024-2025") não contam.
 */
const PADRAO_TELEFONE_BR = new RegExp(
  String.raw`(?<![\w.,/-])(?:\(\s?\d{2}\s?\)|\d{2})[\s.-]?(?!${DOIS_ANOS})(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}(?!\d)`,
  "g",
);
/** Com o 55 do país e sem o "+": "5511912345678", "55 (11) 91234-5678". */
const PADRAO_TELEFONE_55 =
  /(?<![\w.,/-])55[\s.-]?\(?\d{2}\)?[\s.-]?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}(?!\d)/g;
/**
 * Sem DDD e com hífen: "3333-4444" (fixo) e "91234-5678" (celular). É o formato que mais se
 * confunde com número comum, então não vale depois de moeda ("R$ 2000-4000"), antes de unidade
 * ("2000-4000 reais") nem para dois anos.
 */
const PADRAO_TELEFONE_LOCAL = new RegExp(
  String.raw`(?<![\w.,/-])(?<!(?:R\$|US\$|\$|€)\s{0,2})(?!${DOIS_ANOS})(?:9\d{4}|[2-5]\d{3})-\d{4}(?![\d-])(?!\s?(?:reais|real|mil\b|%|mm\b|cm\b|km\b|kg\b|ml\b|m\u00B2|m2\b|anos|dias|horas|min\b|unidades|pessoas))`,
  "g",
);
const PADRAO_TELEFONE_0800 = /(?<![\w.])0[3589]00[\s.-]?\d{3}[\s.-]?\d{3,4}(?!\d)/g;
/**
 * Número depois de um rótulo de contato. O rótulo e o número ficam em grupos separados porque só
 * vale se o número tiver de 8 a 13 dígitos e não for dois anos ("Pedidos 2023-2024" fica).
 */
const PADRAO_TELEFONE_COM_ROTULO =
  /\b(tel(?:efones?)?|fones?|whats(?:app)?|zap|cel(?:ular)?|ligue|chame|phone|call|contato|fale conosco|atendimento|agende|agendamento|reservas?|pedidos|central|sac|disque|contact|contacto)\b[\s:.-]*(\+?[\d()\s.-]{7,20}\d)/gi;
const APENAS_DOIS_ANOS = /^(?:19|20)\d{2}\D{0,3}(?:19|20)\d{2}$/;

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
      .replace(PADRAO_TELEFONE_COM_ROTULO, (inteiro, rotulo: string, numero: string) => {
        const digitos = numero.replace(/\D/g, "");
        const ehTelefone =
          digitos.length >= 8 && digitos.length <= 13 && !APENAS_DOIS_ANOS.test(numero.trim());
        return ehTelefone ? `${rotulo} ` : inteiro;
      })
      .replace(PADRAO_TELEFONE_INTERNACIONAL, " ")
      .replace(PADRAO_TELEFONE_0800, " ")
      .replace(PADRAO_TELEFONE_55, " ")
      .replace(PADRAO_TELEFONE_BR, " ")
      .replace(PADRAO_TELEFONE_LOCAL, " ");
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

/**
 * Por que existe esta seção. O parse5 roda no processo do worker (um só, que também roda o pg-boss
 * e todos os jobs) e é síncrono: nenhum prazo (`AbortSignal`) o interrompe. Ele tem vários
 * caminhos quadráticos no tamanho da pilha de elementos abertos ou da lista de elementos de
 * formatação: cada `</y>` sem par varre a pilha inteira (`<x>` repetido 40 mil vezes e depois
 * `</y>` 40 mil vezes levam 12 segundos, com `<svg>` e `<g>` uns 20), `<div>`, `<li>`, `<p>` e
 * afins conferem a pilha atrás de um `<p>` aberto, e cada `<b a="1">`, `<b a="2">` com atributos
 * diferentes cresce a lista de formatação (10 mil levam 1,4 segundo, 20 mil levam 9). Uma página
 * de 1 MiB cabe com mais de 100 mil dessas tags, o que parava o worker por minutos.
 *
 * A defesa é LIMITAR O TRABALHO ANTES de entregar o texto de terceiros ao parser, com limites que
 * não dependem de como o parser tokeniza (contornar uma varredura heurística já custou três
 * rodadas de evasão: svg com script, comentário abrupto, escopo de tabela):
 * 1. `MAXIMO_DE_MENORES_NO_HTML`: todo token de tag começa com `<`, então o número de `<` do
 *    documento é um limite superior do número de tokens de tag, qualquer que seja a tokenização
 *    (svg, math, elemento desconhecido, comentário abrupto, texto bruto, fechamento sem par). O
 *    documento é cortado antes do `<` de número 10.001.
 * 2. `MAXIMO_DE_ATRIBUTOS_POR_TAG`: o parser confere atributo repetido em O(n²) dentro de UMA tag
 *    (100 mil atributos numa `<div>` levam 35 segundos), e um só `<` não é limitado pelo item 1.
 * 3. `MAXIMO_DE_TAGS_DE_FORMATACAO`: o caso `<b a="1">`, `<b a="2">` acima custa mais por tag que
 *    qualquer outro (a lista de formatação guarda cópia por atributo), então tem teto próprio,
 *    contando TODA abertura (sem descontar fechamento, que o parser pode ignorar).
 * 4. `PROFUNDIDADE_MAXIMA_DO_HTML`: protege a pilha de chamadas do parser (`<template>` aninhado
 *    estoura) e é a defesa que já estava aqui.
 * Com 10 mil tags o pior caso medido de uma página (svg com fechamentos sem par) fica em torno de
 * meio segundo. Só se lê o começo de cada página (6.000 caracteres de texto) e os primeiros links,
 * então cortar uma página com mais de 10 mil tags quase nunca perde algo útil.
 */

/** Até onde o aninhamento dos elementos que aprofundam a pilha do parser pode ir. */
export const PROFUNDIDADE_MAXIMA_DO_HTML = 1_000;
/** Teto de caracteres `<` por documento; ver o item 1 acima. */
export const MAXIMO_DE_MENORES_NO_HTML = 10_000;
/** Teto de atributos por tag (de abertura ou de fechamento); ver o item 2 acima. */
export const MAXIMO_DE_ATRIBUTOS_POR_TAG = 100;
/** Teto de aberturas de elemento de formatação (`b`, `i`, `font`...) por documento; ver o item 3. */
export const MAXIMO_DE_TAGS_DE_FORMATACAO = 2_500;

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
/**
 * Elementos de formatação do parser (a "lista de elementos de formatação ativos"). O `a` fica de
 * fora de propósito: um `<a>` novo fecha o anterior, então a lista não cresce com links (uma
 * página tem centenas) e eles não são o caminho quadrático.
 */
const TAGS_DE_FORMATACAO = new Set([
  "b",
  "big",
  "code",
  "em",
  "font",
  "i",
  "nobr",
  "s",
  "small",
  "strike",
  "strong",
  "tt",
  "u",
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

/** `acharFimDaTag` devolve isto quando a tag tem atributos demais (o documento é cortado antes dela). */
const TAG_COM_ATRIBUTOS_DEMAIS = -2;

/**
 * Fim (`>`) da tag cujo nome terminou em `de`, lendo os atributos como o parser da web: valor
 * entre aspas pode ter `>` (então `a="x>"` repetido não encerra a tag nem a contagem). Devolve -1
 * se a tag não fecha e `TAG_COM_ATRIBUTOS_DEMAIS` se passa de `MAXIMO_DE_ATRIBUTOS_POR_TAG`
 * atributos. Linear no tamanho da tag.
 */
function acharFimDaTag(html: string, de: number): number {
  const n = html.length;
  let k = de;
  let atributos = 0;
  for (;;) {
    while (k < n && (ehEspaco(html.charCodeAt(k)) || html.charCodeAt(k) === 47)) k += 1;
    if (k >= n) return -1;
    if (html.charCodeAt(k) === 62) return k;
    atributos += 1;
    if (atributos > MAXIMO_DE_ATRIBUTOS_POR_TAG) return TAG_COM_ATRIBUTOS_DEMAIS;
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
  /**
   * Anda de `--` em `--` e olha o que vem depois, em vez de procurar `-->` e `--!>` cada um até o
   * fim do documento: com milhares de comentários e nenhum `--!>`, a segunda busca varreria o
   * resto do arquivo a cada comentário (O(n²)). Assim cada comentário só lê até o próprio fim.
   */
  let hifens = html.indexOf("--", inicio);
  while (hifens !== -1) {
    const depois = html.charCodeAt(hifens + 2);
    if (depois === 62) return hifens + 3;
    if (depois === 33 && html.charCodeAt(hifens + 3) === 62) return hifens + 4;
    hifens = html.indexOf("--", hifens + 1);
  }
  return -1;
}

/**
 * Corta o documento antes do `<` de número `MAXIMO_DE_MENORES_NO_HTML` + 1 (o item 1 da seção).
 * Não lê nada além de `<`: vale qualquer que seja a tokenização, e é linear.
 */
function cortarNoLimiteDeMenores(html: string): string {
  let posicao = -1;
  for (let vistos = 0; vistos < MAXIMO_DE_MENORES_NO_HTML; vistos += 1) {
    posicao = html.indexOf("<", posicao + 1);
    if (posicao === -1) return html;
  }
  const excedente = html.indexOf("<", posicao + 1);
  return excedente === -1 ? html : html.slice(0, excedente);
}

/**
 * Entrega ao parser só o que ele consegue ler sem parar o worker (a seção acima explica os
 * quatro limites). Primeiro o teto de `<` por documento, que não depende de tokenização; depois
 * uma varredura só, linear, que corta antes da tag em que:
 * - o aninhamento dos elementos que aprofundam a pilha passa de `PROFUNDIDADE_MAXIMA_DO_HTML`
 *   (conta abertura e fechamento só das tags que aprofundam; `p` e `li`, de fechamento opcional,
 *   não entram);
 * - as aberturas de elemento de formatação passam de `MAXIMO_DE_TAGS_DE_FORMATACAO`;
 * - uma tag (de abertura ou de fechamento) tem mais de `MAXIMO_DE_ATRIBUTOS_POR_TAG` atributos.
 * A varredura pula comentário e conteúdo de `script`, `style` e afins, e lê atributos como o
 * parser (com aspas), então um `<div>` dentro de um texto de script não conta e uma aspa solta não
 * esconde o aninhamento do parser de verdade. Dentro de `<svg>` e `<math>` (conteúdo estrangeiro,
 * onde `<script>` e `<style>` são elementos comuns e um `<div>` sai de volta para o HTML) nada é
 * pulado como texto bruto. Todo erro de leitura da varredura é para o lado de contar a mais (o
 * pior que acontece é cortar uma página esquisita), nunca a menos; e o teto de `<` vale mesmo se
 * ela errar. Página normal passa intacta.
 */
export function limitarComplexidadeDoHtml(entrada: string): string {
  const html = cortarNoLimiteDeMenores(entrada);
  const n = html.length;
  let profundidade = 0;
  let formatacao = 0;
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
    if (fimDaTag === TAG_COM_ATRIBUTOS_DEMAIS) return html.slice(0, abre);
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
        fechamento = new RegExp(String.raw`</${nome}[\s/>]`, "gi");
        FECHAMENTO_DE_TEXTO_BRUTO.set(nome, fechamento);
      }
      fechamento.lastIndex = i;
      const achou = fechamento.exec(html);
      if (!achou) break;
      i = achou.index;
      continue;
    }
    if (TAGS_DE_FORMATACAO.has(nome)) formatacao += 1;
    if (TAGS_QUE_APROFUNDAM.has(nome)) profundidade += 1;
    if (profundidade > PROFUNDIDADE_MAXIMA_DO_HTML || formatacao > MAXIMO_DE_TAGS_DE_FORMATACAO) {
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
/**
 * O texto não entra, mas os links sim (o menu está aqui). `form` NÃO está aqui: site antigo (o
 * ASP.NET WebForms) embrulha a página inteira num `<form>`, então ele só vale como "interface"
 * quando é curto ou é busca (ver `ehFormularioDeInterface`).
 */
const TAGS_SEM_TEXTO = new Set([
  "nav",
  "aside",
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
/**
 * Aviso de consentimento de cookies, reconhecido por padrões específicos de CLASSE ou ID, e não
 * pela palavra solta: `cookies` é produto numa confeitaria (a classe `product_cat-cookies` do
 * WooCommerce, `category-cookies` num blog) e não é aviso. Cada token da classe (e o id) é
 * dividido em palavras por `-` e `_`; vale uma frase conhecida de aviso ("cookie banner",
 * "consent notice", "cc window"...) ou um token que COMEÇA com o nome de uma ferramenta de
 * consentimento (cmplz, onetrust, cookiebot...). Os dois regex são lineares (alternância de
 * literais curtos, sem quantificador aninhado) e só rodam em quem passa no pré-filtro.
 */
const PRE_FILTRO_DE_AVISO =
  /cookie|consent|gdpr|lgpd|cmplz|onetrust|ot-sdk|didomi|iubenda|trustarc|truste|termly|osano|complianz|cc-/i;
const FRASE_DE_AVISO_DE_COOKIE =
  /-(?:cookies?-(?:banner|notice|consent|law|bar|popup|modal|message|warning|wall|alert|dialog|overlay|choice|script|aviso|info)|(?:banner|barra|aviso|notice|popup|modal|bar)-(?:de-)?cookies?|consent-(?:banner|notice|bar|popup|modal|manager|wall|dialog|overlay|cookies?)|(?:gdpr|lgpd)-(?:banner|notice|aviso|bar|popup|modal|consent|cookies?)|cc-(?:window|banner|revoke|dialog|grower|compliance)|ot-sdk|eu-cookie)-/;
const NOME_DE_FERRAMENTA_DE_CONSENTIMENTO =
  /^(?:cmplz|onetrust|cookiebot|cybotcookiebot|cookieconsent|cookiebanner|cookienotice|cookiebar|cookiepopup|cookiechoice|cookiescript|didomi|iubenda|trustarc|truste|termly|complianz|osano)/;

function tokenEhAvisoDeCookie(token: string): boolean {
  const minusculo = token.toLowerCase().slice(0, 120);
  if (NOME_DE_FERRAMENTA_DE_CONSENTIMENTO.test(minusculo)) return true;
  const palavras = minusculo.split(/[-_]+/).filter(Boolean);
  return FRASE_DE_AVISO_DE_COOKIE.test(`-${palavras.join("-")}-`);
}

/** `class` e `id` de um elemento viram tokens; o bloco é aviso se qualquer um for. */
export function classeOuIdDeAvisoDeCookie(classe: string, id: string): boolean {
  const alvo = `${classe.slice(0, 2_000)} ${id.slice(0, 200)}`;
  if (!PRE_FILTRO_DE_AVISO.test(alvo)) return false;
  return alvo.split(/\s+/).some((token) => token !== "" && tokenEhAvisoDeCookie(token));
}

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
  /** Fatiado antes do regex: o `style` é de terceiros. Um estilo que esconde fica no começo. */
  const estilo = atributo(elemento, "style")?.slice(0, 2_000);
  if (estilo && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(estilo)) return true;
  const papel = atributo(elemento, "role")?.toLowerCase();
  if (papel && PAPEIS_SEM_TEXTO.has(papel)) {
    /** `<header role="banner">` e `<footer role="contentinfo">` são só o papel implícito do elemento: quem decide é `ehMenuOuRodapeSolto`. */
    const papelImplicito =
      (elemento.tagName === "header" && papel === "banner") ||
      (elemento.tagName === "footer" && papel === "contentinfo");
    if (!papelImplicito) return true;
  }
  return atributo(elemento, "aria-modal")?.toLowerCase() === "true";
}

/**
 * Quanto a página ainda pode gastar nas conferências que descem pela subárvore de um elemento
 * (`textoCurto` e `resumoDaSubarvore`). Sem este teto, um aninhamento de elementos "suspeitos"
 * (uma conferência por nível, cada uma descendo até o fundo) custaria O(n²) nós.
 */
type OrcamentoDeNos = { restante: number };

/**
 * Conta caracteres de texto de uma subárvore e diz se passa de `limite` (sem recursão profunda).
 * Gasta no máximo `NOS_POR_CONFERENCIA` nós, e do `orcamento` da página; estourou um dos dois,
 * devolve `false` ("não é curto"): quem chama trata isso como "não é aviso, não é formulário de
 * interface", ou seja, deixa o texto passar, que é o lado seguro.
 */
function textoCurto(raiz: No, limite: number, orcamento: OrcamentoDeNos): boolean {
  let total = 0;
  let visitados = 0;
  const pilha: No[] = [raiz];
  while (pilha.length > 0) {
    if (visitados >= NOS_POR_CONFERENCIA || orcamento.restante <= 0) return false;
    visitados += 1;
    orcamento.restante -= 1;
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

function ehBlocoDeCookie(elemento: Elemento, orcamento: OrcamentoDeNos): boolean {
  if (elemento.tagName === "html" || elemento.tagName === "body" || elemento.tagName === "main")
    return false;
  const classe = atributo(elemento, "class") ?? "";
  const id = atributo(elemento, "id") ?? "";
  if (!classeOuIdDeAvisoDeCookie(classe, id)) return false;
  /** Uma classe como "has-cookie-banner" no contêiner da página inteira não pode esconder a página: só texto curto conta. */
  return textoCurto(elemento, TEXTO_CURTO_DO_BLOCO_DE_COOKIE, orcamento);
}

/**
 * O que importa saber de uma subárvore (formulário, cabeçalho ou rodapé) para decidir se ela é só
 * interface. Não desce em `nav` (a presença já basta), nem em controles de formulário nem em
 * código, que não rendem texto.
 */
type ResumoDaSubarvore = {
  temNav: boolean;
  temH1: boolean;
  paragrafos: number;
  caracteres: number;
  caracteresDeLink: number;
  /** O orçamento de nós acabou antes de terminar a conferência. */
  incompleto: boolean;
};

const TAGS_QUE_O_RESUMO_NAO_DESCE = new Set(["select", "textarea", "button", "option"]);

function resumoDaSubarvore(raiz: Elemento, orcamento: OrcamentoDeNos): ResumoDaSubarvore {
  const resumo: ResumoDaSubarvore = {
    temNav: false,
    temH1: false,
    paragrafos: 0,
    caracteres: 0,
    caracteresDeLink: 0,
    incompleto: false,
  };
  let visitados = 0;
  const pilha: { no: No; emLink: boolean }[] = [{ no: raiz, emLink: false }];
  while (pilha.length > 0) {
    if (visitados >= NOS_POR_CONFERENCIA || orcamento.restante <= 0) {
      resumo.incompleto = true;
      return resumo;
    }
    visitados += 1;
    orcamento.restante -= 1;
    const { no, emLink } = pilha.pop() as { no: No; emLink: boolean };
    if (no.nodeName === "#text" && "value" in no) {
      const tamanho = no.value.trim().length;
      resumo.caracteres += tamanho;
      if (emLink) resumo.caracteresDeLink += tamanho;
      continue;
    }
    if (!("tagName" in no) || TAGS_INTOCADAS.has(no.tagName)) continue;
    if (no.tagName === "nav" || atributo(no, "role")?.toLowerCase() === "navigation") {
      resumo.temNav = true;
      continue;
    }
    if (TAGS_QUE_O_RESUMO_NAO_DESCE.has(no.tagName)) continue;
    if (no.tagName === "h1") resumo.temH1 = true;
    if (no.tagName === "p") resumo.paragrafos += 1;
    const dentroDeLink = emLink || no.tagName === "a";
    for (const filho of no.childNodes) pilha.push({ no: filho, emLink: dentroDeLink });
  }
  return resumo;
}

/** Quantos parágrafos um formulário pode ter e ainda valer como interface (busca, newsletter, contato). */
const PARAGRAFOS_DE_FORMULARIO_DE_INTERFACE = 2;

/**
 * Formulário que é só interface (busca, newsletter, contato com poucos campos) e não deve render
 * texto: `role="search"`, ou texto curto, sem `h1` e com poucos parágrafos. Um formulário que
 * carrega a página inteira (o ASP.NET WebForms embrulha tudo num `<form runat="server">`) tem
 * `h1`, vários parágrafos ou texto longo, e fica de pé. Sem orçamento para decidir, o texto fica.
 */
function ehFormularioDeInterface(elemento: Elemento, orcamento: OrcamentoDeNos): boolean {
  if (atributo(elemento, "role")?.toLowerCase() === "search") return true;
  const resumo = resumoDaSubarvore(elemento, orcamento);
  return (
    !resumo.incompleto &&
    resumo.caracteres <= TEXTO_CURTO_DO_FORMULARIO &&
    !resumo.temH1 &&
    resumo.paragrafos <= PARAGRAFOS_DE_FORMULARIO_DE_INTERFACE
  );
}

/** Acima desta fração do texto em links, o cabeçalho ou rodapé é lista de links, não conteúdo. */
const FRACAO_DE_LINK_DE_MENU = 0.6;

/**
 * `header` ou `footer` solto (fora de article, section e main) só é descartado quando parece menu:
 * tem `nav`, ou é dominado por links, ou não tem `h1`. Um `<header class="masthead">` de página de
 * apresentação, com o `h1` e a proposta de valor, é conteúdo e fica. Sem orçamento para decidir,
 * vale o comportamento antigo (descartar).
 */
function ehMenuOuRodapeSolto(elemento: Elemento, orcamento: OrcamentoDeNos): boolean {
  const resumo = resumoDaSubarvore(elemento, orcamento);
  if (resumo.incompleto || resumo.temNav || !resumo.temH1) return true;
  return (
    resumo.caracteres > 0 && resumo.caracteresDeLink / resumo.caracteres >= FRACAO_DE_LINK_DE_MENU
  );
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
/** Soma dos blocos que se leem (um bloco inteiro acima do teto individual já é pulado). */
const JSON_LD_TOTAL_MAXIMO_CARACTERES = 400_000;
/** Quanto de cada texto de JSON-LD se olha antes de qualquer regex (o resto nunca entra, o teto é 600). */
const JSON_LD_TEXTO_ENTRADA_MAXIMA = 2_000;
const JSON_LD_TEXTO_PROFUNDIDADE_MAXIMA = 3;

/**
 * Texto de um valor do JSON-LD. A string é FATIADA antes de qualquer regex, e a remoção de tags
 * usa `<[^<>]{0,500}>`: a classe não aceita `<`, então a busca a partir de cada `<` nunca passa de
 * outro `<` e o custo é linear (o regex antigo, `<[^>]*>`, era O(n²) em `<<<<...` sem `>`: 100 mil
 * `<` levavam 4 segundos, e cinco blocos assim 88).
 */
function textoDeJsonLd(valor: unknown, profundidade = 0): string[] {
  if (profundidade > JSON_LD_TEXTO_PROFUNDIDADE_MAXIMA) return [];
  if (typeof valor === "string") {
    const limpo = colapsarEspacos(
      valor
        .slice(0, JSON_LD_TEXTO_ENTRADA_MAXIMA)
        .replace(/<[^<>]{0,500}>/g, " ")
        .replace(/[<>]/g, " "),
    ).slice(0, 600);
    return limpo ? [limpo] : [];
  }
  if (Array.isArray(valor))
    return valor.slice(0, 20).flatMap((item) => textoDeJsonLd(item, profundidade + 1));
  if (valor && typeof valor === "object" && "name" in valor)
    return textoDeJsonLd((valor as { name: unknown }).name, profundidade + 1);
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
  let lidos = 0;
  for (const bloco of blocos.slice(0, JSON_LD_BLOCOS_MAXIMOS)) {
    if (bloco.length > JSON_LD_BLOCO_MAXIMO_CARACTERES) continue;
    lidos += bloco.length;
    if (lidos > JSON_LD_TOTAL_MAXIMO_CARACTERES) break;
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
 * afins, pulando código, estilo, menu (`nav`, `aside`, e `header` e `footer` soltos que parecem
 * menu: com `nav`, dominados por links ou sem `h1`), formulário de interface (curto, sem `h1`, ou
 * de busca; a página embrulhada num `form` fica), escondido, janela, aviso de cookie e consentimento
 * (por padrões específicos de classe e id, não pela palavra solta). Se isso render menos de 200
 * caracteres (página montada com `div`, ou de página única com `<noscript>`), recorre a todo o
 * texto visível mais o `<noscript>`. Do JSON-LD entram só campos de texto de tipos conhecidos.
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
  const orcamento: OrcamentoDeNos = { restante: NOS_POR_PAGINA };

  while (pilha.length > 0) {
    const item = pilha.pop() as ItemDaPilha;
    if ("fimDeBloco" in item) {
      descarregar();
      continue;
    }
    const { no, contexto } = item;

    if (no.nodeName === "#text" && "value" in no) {
      const valor = no.value.replace(/\s+/g, " ");
      if (contexto.link && contexto.link.texto.length < 200)
        contexto.link.texto += valor.slice(0, 200);
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
      else if (estaEscondido(no)) coletar = false;
      else if (tag === "form" && ehFormularioDeInterface(no, orcamento)) coletar = false;
      else if (
        (tag === "header" || tag === "footer") &&
        !contexto.secao &&
        ehMenuOuRodapeSolto(no, orcamento)
      )
        coletar = false;
      else if (ehBlocoDeCookie(no, orcamento)) coletar = false;
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

/**
 * Áreas que não ajudam a entender a marca. O descarte é por SEGMENTO INTEIRO do caminho (igual a
 * um destes) ou por FRASE FIXA dentro de um segmento (palavras inteiras na ordem, em
 * `FRASES_DESCARTADAS`), nunca por palavra solta dentro de um slug: `/entrar-em-contato`,
 * `/servicos/search-engine-optimization`, `/servicos/busca-e-apreensao`, `/termos-de-garantia`,
 * `/blog/feed-de-noticias` e `/atuacao/privacy-law` são páginas de verdade.
 */
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
  "cookie",
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
const FRASES_DESCARTADAS = [
  "minha-conta",
  "my-account",
  "finalizar-compra",
  "politica-de-privacidade",
  "politica-de-cookies",
  "politica-de-cookie",
  "termos-de-uso",
  "termos-e-condicoes",
  "termos-de-servico",
  "privacy-policy",
  "cookie-policy",
  "cookies-policy",
  "terms-of-service",
  "terms-of-use",
  "terms-and-conditions",
  "lista-de-desejos",
  "esqueci-minha-senha",
  "esqueci-a-senha",
  "recuperar-senha",
  "lost-password",
  "sign-in",
  "sign-up",
  "log-in",
  "log-out",
];
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

/** `true` se o segmento do caminho é uma área descartada (inteiro, ou com uma das frases fixas). */
function segmentoDescartado(segmento: string): boolean {
  if (SEGMENTOS_DESCARTADOS.has(segmento)) return true;
  const palavras = `-${tokensDe(segmento).join("-")}-`;
  return FRASES_DESCARTADAS.some((frase) => palavras.includes(`-${frase}-`));
}

/** O segmento já decodificado (`pol%C3%ADtica` vira `política`); o que não decodifica fica como está. */
function decodificarSegmento(segmento: string): string {
  try {
    return decodeURIComponent(segmento);
  } catch {
    return segmento;
  }
}

/**
 * Resolve, limpa e valida um link da página. Devolve `null` para tudo que não é uma página
 * do mesmo site: outro host (subdomínio irmão, como "loja.", fica de fora), `mailto:`,
 * `tel:`, `javascript:`, âncora, arquivo, IP, rastreio, endereço enorme e áreas que não ajudam
 * (login, carrinho, privacidade, termos, administração, feed; ver `SEGMENTOS_DESCARTADOS`).
 * `http` do mesmo site sobe para `https`. A barra final do caminho FICA: é o formato em que o
 * site escreveu o link, e pedir sem ela gasta um redirecionamento por página em WordPress (o
 * `/sobre` responde 301 para `/sobre/`). Quem compara endereços usa `chaveDaUrl`.
 */
export function normalizarLink(href: string, base: URL, hostPermitido: string): URL | null {
  if (href.length > HREF_MAXIMO * 2) return null;
  const bruto = href.trim();
  if (bruto === "" || bruto.length > HREF_MAXIMO || bruto.startsWith("#")) return null;
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
    .map((segmento) => decodificarSegmento(segmento).toLowerCase());
  if (segmentos.some(segmentoDescartado)) return null;

  url.pathname = caminho;
  return url;
}

/** Caminho e query sem a barra final: a chave para juntar duplicatas e reconhecer a própria página. */
function chaveDaUrl(url: URL): string {
  const caminho =
    url.pathname.length > 1 && url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;
  return `${caminho}${url.search}`;
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

/**
 * Uma regra já pronta para casar: o padrão cortado em segmentos pelos `*` (`segmentos[0]` é o
 * prefixo obrigatório; o último é o fim; os do meio são procurados em ordem com `indexOf`).
 */
type RegraDeRobots = {
  permitir: boolean;
  /** Padrão normalizado, sem o `$` final (o tamanho dele é o critério de "maior correspondência"). */
  padrao: string;
  segmentos: string[];
  ancorado: boolean;
};

/**
 * O robots.txt é de terceiros e o dono dele também escolhe os links da página, então os dois
 * lados do casamento são adversários. O custo é limitado na origem, independente de como o
 * casamento funciona: no máximo `ROBOTS_REGRAS_AVALIADAS_MAXIMAS` regras entram na avaliação,
 * cada uma com até `ROBOTS_CURINGAS_MAXIMOS` curingas e `ROBOTS_PADRAO_MAXIMO` caracteres (regra
 * que passa disso é ignorada), contra um caminho de até `ROBOTS_CAMINHO_MAXIMO` caracteres. O
 * casamento procura os trechos entre curingas com `indexOf` (sem retrocesso) e `permite`
 * memoriza o resultado por caminho. Antes disto, 500 a 2.000 regras `Disallow: /sobre/*aaa...b`
 * contra um caminho de 2 KB levavam de 4 a 7 segundos por chamada de `permite`.
 */
const ROBOTS_REGRAS_GUARDADAS_MAXIMAS = 5_000;
const ROBOTS_REGRAS_AVALIADAS_MAXIMAS = 1_000;
const ROBOTS_CURINGAS_MAXIMOS = 5;
const ROBOTS_PADRAO_MAXIMO = 200;
/** Linha de regra maior que isto nem é normalizada (a regra é ignorada). */
const ROBOTS_VALOR_MAXIMO = 1_024;
const ROBOTS_CAMINHO_MAXIMO = 512;
const ROBOTS_CAMINHOS_MEMORIZADOS_MAXIMOS = 256;
const ROBOTS_SITEMAPS_MAXIMOS = 20;
const ROBOTS_SITEMAP_ENDERECO_MAXIMO = 2_048;

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

/**
 * A regra casa com o caminho? Prefixo com curinga `*` (e `$` no fim, já tirado e guardado em
 * `ancorado`). `segmentos` são os trechos entre os curingas: o primeiro é prefixo do caminho, os do
 * meio são procurados em ordem (o primeiro achado de cada um é sempre o melhor, porque deixa mais
 * caminho para os seguintes) e o último fica solto no resto, ou preso ao fim se `ancorado`. Cada
 * passo é um `indexOf`/`startsWith`/`endsWith`, sem retrocesso.
 */
function casaRegra(regra: RegraDeRobots, caminho: string): boolean {
  const { segmentos, ancorado } = regra;
  const primeiro = segmentos[0];
  if (!caminho.startsWith(primeiro)) return false;
  if (segmentos.length === 1) return !ancorado || caminho.length === primeiro.length;
  let posicao = primeiro.length;
  const ultimo = segmentos.length - 1;
  for (let i = 1; i < ultimo; i += 1) {
    const achado = caminho.indexOf(segmentos[i], posicao);
    if (achado === -1) return false;
    posicao = achado + segmentos[i].length;
  }
  const fim = segmentos[ultimo];
  /** Curinga no fim do padrão (com ou sem `$`): absorve o resto do caminho. */
  if (fim === "") return true;
  if (ancorado) return caminho.length - fim.length >= posicao && caminho.endsWith(fim);
  return caminho.indexOf(fim, posicao) !== -1;
}

/**
 * Prepara uma linha `Allow`/`Disallow`: normaliza, tira o `$` final, junta curingas seguidos e
 * ignora (devolve `null`) o que passa dos tetos. Uma regra ignorada não proíbe nem libera nada.
 */
function prepararRegra(chave: "allow" | "disallow", valor: string): RegraDeRobots | null {
  if (valor === "" || valor.length > ROBOTS_VALOR_MAXIMO) return null;
  const ancorado = valor.endsWith("$");
  const padrao = normalizarCaminhoDeRobots(ancorado ? valor.slice(0, -1) : valor).replace(
    /\*{2,}/g,
    "*",
  );
  if (padrao.length > ROBOTS_PADRAO_MAXIMO) return null;
  const segmentos = padrao.split("*");
  if (segmentos.length - 1 > ROBOTS_CURINGAS_MAXIMOS) return null;
  return { permitir: chave === "allow", padrao, segmentos, ancorado };
}

/**
 * Lê um robots.txt para o nosso agente. Grupos por `User-agent` (linhas seguidas formam um
 * grupo); o grupo que cita o nosso token (igual ou começando por ele e hífen) vale no lugar
 * do `*`; `Allow` e `Disallow` por maior correspondência (empate fica com `Allow`); `*` e
 * `$` nos padrões; `Allow` ou `Disallow` vazio não faz nada; `/robots.txt` é sempre
 * permitido. Sem grupo que se aplique, tudo é permitido. Os tetos de custo estão em
 * `ROBOTS_REGRAS_GUARDADAS_MAXIMAS` e vizinhas.
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
      atual.agentes.push(valor.toLowerCase().slice(0, 200));
      ultimaFoiAgente = true;
    } else if (chave === "allow" || chave === "disallow") {
      if (!atual) continue;
      ultimaFoiAgente = false;
      if (totalDeRegras >= ROBOTS_REGRAS_GUARDADAS_MAXIMAS) continue;
      const regra = prepararRegra(chave, valor);
      if (!regra) continue;
      atual.regras.push(regra);
      totalDeRegras += 1;
    } else if (chave === "sitemap") {
      if (
        valor &&
        valor.length <= ROBOTS_SITEMAP_ENDERECO_MAXIMO &&
        sitemaps.length < ROBOTS_SITEMAPS_MAXIMOS
      )
        sitemaps.push(valor);
    }
  }

  const cita = (agente: string) =>
    agente !== "*" && agente !== "" && (token === agente || token.startsWith(`${agente}-`));
  const especificos = grupos.filter((grupo) => grupo.agentes.some(cita));
  const aplicaveis =
    especificos.length > 0 ? especificos : grupos.filter((grupo) => grupo.agentes.includes("*"));
  /**
   * Só as primeiras regras entram na avaliação, e já em ordem de "maior correspondência": a mais
   * longa primeiro, `Allow` antes de `Disallow` no empate. Assim `permite` devolve na primeira que
   * casa, e o resultado é o mesmo da comparação regra a regra.
   */
  const regras = aplicaveis
    .flatMap((grupo) => grupo.regras)
    .slice(0, ROBOTS_REGRAS_AVALIADAS_MAXIMAS)
    .sort((a, b) => b.padrao.length - a.padrao.length || Number(b.permitir) - Number(a.permitir));
  const memorizados = new Map<string, boolean>();

  return {
    sitemaps,
    permite(caminho: string): boolean {
      const alvo = normalizarCaminhoDeRobots(caminho.slice(0, 2_048)).slice(
        0,
        ROBOTS_CAMINHO_MAXIMO,
      );
      const jaSei = memorizados.get(alvo);
      if (jaSei !== undefined) return jaSei;
      let resultado = true;
      if (alvo !== "/robots.txt" && !alvo.startsWith("/robots.txt?")) {
        const casou = regras.find((regra) => casaRegra(regra, alvo));
        if (casou) resultado = casou.permitir;
      }
      if (memorizados.size < ROBOTS_CAMINHOS_MEMORIZADOS_MAXIMOS) memorizados.set(alvo, resultado);
      return resultado;
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
/** Um `<loc>` maior que isto é lixo: não vira endereço (e não passa por regex nem por `URL`). */
const SITEMAP_LOC_MAXIMO = 2_048;
/** Quanto do começo do XML se olha atrás do `<sitemapindex>`, que é o elemento raiz. */
const SITEMAP_INICIO_PARA_O_INDICE = 50_000;

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
 * posição, sem regex com varredura longa, porque o XML vem de terceiros e chega a 1 MiB: cada
 * `indexOf` anda a partir do ponto em que o anterior parou, então o custo total é linear. Só os
 * trechos de até `SITEMAP_LOC_MAXIMO` passam pelas substituições de entidade.
 */
export function extrairLocsDeSitemap(xml: string): { urls: string[]; ehIndice: boolean } {
  const ehIndice = /<sitemapindex[\s>]/.test(xml.slice(0, SITEMAP_INICIO_PARA_O_INDICE));
  const urls: string[] = [];
  let posicao = 0;
  while (urls.length < SITEMAP_LOCS_MAXIMOS) {
    const abre = xml.indexOf("<loc>", posicao);
    if (abre === -1) break;
    const inicio = abre + "<loc>".length;
    const fecha = xml.indexOf("</loc>", inicio);
    if (fecha === -1) break;
    posicao = fecha + "</loc>".length;
    /** Com folga para o `<![CDATA[` e os espaços em volta. */
    if (fecha - inicio > SITEMAP_LOC_MAXIMO + 64) continue;
    let conteudo = xml.slice(inicio, fecha).trim();
    if (conteudo.startsWith("<![CDATA[") && conteudo.endsWith("]]>"))
      conteudo = conteudo.slice(9, -3).trim();
    else conteudo = decodificarEntidadesXml(conteudo);
    if (conteudo && conteudo.length <= SITEMAP_LOC_MAXIMO) urls.push(conteudo);
  }
  return { urls, ehIndice };
}

/** O que um endereço de sitemap diz sobre o que ele lista: positivo é página, negativo é o que não serve. */
function pontoDoSitemapFilho(url: string): number {
  const tokens = tokensDe(url.slice(0, SITEMAP_LOC_MAXIMO));
  if (
    tokens.some(
      (token) => token === "page" || token === "pages" || token === "pagina" || token === "paginas",
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
}

/**
 * De um índice de sitemaps, o filho que mais parece listar páginas (e não artigos, produtos ou
 * imagens). Cada endereço é pontuado UMA vez, e o primeiro de maior pontuação ganha (o mesmo
 * resultado de ordenar, sem reavaliar os endereços a cada comparação: um índice com milhares de
 * filhos custava milhares de vezes mais).
 */
export function escolherSitemapFilho(urls: string[]): string | null {
  let melhor: string | null = null;
  let melhorPonto = -Infinity;
  for (const url of urls) {
    const ponto = pontoDoSitemapFilho(url);
    if (ponto > melhorPonto) {
      melhor = url;
      melhorPonto = ponto;
    }
  }
  return melhor;
}
