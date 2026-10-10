/**
 * As partes puras da E53 (assuntos que a pessoa acompanha): o que é "casar" um assunto com um texto, a junção de duplicatas por título e endereço, a leitura de um item de RSS
 * (veículo, hora, foto) e a foto de página. Sem banco e sem rede, para testar de verdade; quem busca e grava é `jobs/coleta-assuntos.ts`.
 */

/** Sem acento, sem maiúscula, espaços únicos: a forma em que dois textos se comparam. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Os termos que valem para um assunto: o texto e os termos dados, normalizados, sem repetir e sem vazios (no máximo 8). */
export function termosDoAssunto(texto: string, termos: string[]): string[] {
  const todos = [texto, ...termos].map(normalizarTexto).filter((t) => t.length >= 2);
  return [...new Set(todos)].slice(0, 8);
}

/** O termo aparece no texto como palavra (ou sequência de palavras) inteira: "eleição" casa com "a eleição de 2026" e não com "reeleição". */
function contemTermo(textoNormalizado: string, termoNormalizado: string): boolean {
  return ` ${textoNormalizado} `.includes(` ${termoNormalizado} `);
}

/** O texto (um título de notícia, um tema, um momento) toca o assunto: algum termo dele aparece como palavra inteira. */
export function casaComAssunto(texto: string, termosNormalizados: string[]): boolean {
  const normalizado = normalizarTexto(texto);
  return termosNormalizados.some((termo) => contemTermo(normalizado, termo));
}

/** Na Folha o link do feed é um redirecionador que embrulha o endereço verdadeiro depois de um asterisco; devolve o verdadeiro (ou o próprio link, se não houver). */
export function desembrulharLink(link: string): string {
  const embrulhado = /\*(https?:\/\/.+)$/.exec(link.trim());
  return embrulhado ? embrulhado[1] : link.trim();
}

/** O endereço sem o que varia à toa (parâmetros de campanha, âncora, barra final) e, na Folha, sem o redirecionador que embrulha o link verdadeiro. */
export function enderecoCanonico(url: string): string {
  let cru = url.trim();
  const embrulhado = /\*(https?:\/\/.+)$/.exec(cru);
  if (embrulhado) cru = embrulhado[1];
  try {
    const u = new URL(cru);
    for (const chave of [...u.searchParams.keys()]) {
      if (chave.toLowerCase().startsWith("utm_") || ["ref", "cmpid", "origin", "fbclid", "gclid"].includes(chave.toLowerCase())) u.searchParams.delete(chave);
    }
    u.hash = "";
    const caminho = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
    return `${u.protocol}//${u.host.toLowerCase().replace(/^www\./, "")}${caminho}${u.search}`;
  } catch {
    return cru;
  }
}

export type NoticiaDeFeed = {
  titulo: string;
  veiculo: string;
  url: string;
  publicadoEm: Date | null;
  imagemUrl: string | null;
  /** O trecho que o PRÓPRIO feed oferece (descrição curta); só alimenta o resumo nosso, nunca é guardado. */
  trecho: string;
  origem: "rss" | "google";
};

/**
 * Junta o que é a mesma notícia (mesmo endereço, ou o mesmo título) vinda de fontes diferentes: fica uma só, a do RSS direto do veículo quando há (traz a foto e a hora exata), senão a que tem
 * foto, senão a primeira. Mantém a ordem da primeira aparição.
 */
export function juntarDuplicatas(itens: NoticiaDeFeed[]): NoticiaDeFeed[] {
  const melhor = (a: NoticiaDeFeed, b: NoticiaDeFeed): NoticiaDeFeed => {
    const pontos = (n: NoticiaDeFeed) => (n.origem === "rss" ? 2 : 0) + (n.imagemUrl ? 1 : 0) + (n.publicadoEm ? 0.5 : 0);
    return pontos(b) > pontos(a) ? b : a;
  };
  const porChave = new Map<string, number>();
  const saida: NoticiaDeFeed[] = [];
  for (const item of itens) {
    const chaves = [`u:${enderecoCanonico(item.url)}`, `t:${normalizarTexto(item.titulo)}`];
    const achada = chaves.map((c) => porChave.get(c)).find((i): i is number => i !== undefined);
    if (achada === undefined) {
      const indice = saida.push(item) - 1;
      for (const c of chaves) porChave.set(c, indice);
    } else {
      saida[achada] = melhor(saida[achada], item);
      for (const c of chaves) porChave.set(c, achada);
    }
  }
  return saida;
}

const MESES: Record<string, number> = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11, feb: 1, apr: 3, may: 4, aug: 7, sep: 8, oct: 9, dec: 11 };

/** A data de um item de RSS: o que `Date` entende, ou "Ter, 06 Out 2026 10:00:09 -0300" (a UOL escreve o dia e o mês em português). Nula se não der para ler. */
export function lerDataDeFeed(texto: string | undefined | null): Date | null {
  if (!texto) return null;
  const direta = new Date(texto);
  if (!Number.isNaN(direta.getTime())) return direta;
  const m = /(\d{1,2})\s+([A-Za-zçÇ]{3})[a-z]*\.?\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4})?/.exec(texto);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase().slice(0, 3)];
  if (mes === undefined) return null;
  const zona = m[7] ? `${m[7].slice(0, 3)}:${m[7].slice(3)}` : "Z";
  const iso = `${m[3]}-${String(mes + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}T${m[4]}:${m[5]}:${m[6] ?? "00"}${zona}`;
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? null : data;
}

/** O texto de um trecho de HTML, sem as marcas, sem o "Leia mais" e curto (o suficiente para o resumo, longe de ser a matéria). */
export function trechoSemHtml(html: string | undefined | null, limite = 320): string {
  if (!html) return "";
  // Primeiro as entidades (a Folha escapa até o "Leia mais"), depois as marcas.
  const texto = html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]*>/g, " ")
    .replace(/\(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}h\d{2}\)/g, " ")
    .replace(/\bLeia mais\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return texto.length > limite ? `${texto.slice(0, limite).trimEnd()}...` : texto;
}

/** A primeira imagem de um trecho de HTML (`<img src>`), ou nula. */
export function primeiraImagemDoHtml(html: string | undefined | null): string | null {
  if (!html) return null;
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return m ? m[1] : null;
}

/** A foto de uma página, pela meta `og:image` (nas duas ordens de atributos); nula se não houver, ou se não for um endereço http. */
export function imagemDaPagina(html: string): string | null {
  const m = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html) ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
  const url = m?.[1]?.replace(/&amp;/g, "&");
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** O crédito da foto: sempre o veículo da notícia, nunca nós. */
export function creditoDaFoto(veiculo: string): string {
  return `Foto: ${veiculo}`;
}

/** "6 de outubro" (o dia da notícia, para o roteiro dizer "segundo o G1, ontem", no fuso do Brasil). */
export function diaPorExtenso(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(data);
}

/**
 * Um endereço que pode ser gravado e depois virar link ou foto na tela: só https, até 2048 caracteres, sem credencial (`https://usuario:senha@...`) e sem IP direto. O que não passa vira nulo.
 * (A tela do passo 20 ainda põe `referrerpolicy="no-referrer"` na foto e revalida o endereço antes de usar como `href`.)
 */
export function enderecoHttpsSeguro(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const limpo = texto.trim();
  if (limpo.length === 0 || limpo.length > 2048) return null;
  try {
    const url = new URL(limpo);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hostname === "") return null;
    if (url.port !== "" && url.port !== "443") return null;
    if (/^[\d.]+$/.test(url.hostname) || url.hostname.includes(":")) return null;
    return limpo;
  } catch {
    return null;
  }
}

/**
 * Um texto de fora (título, veículo, resumo de notícia) para entrar num prompt como DADO: sem quebra de linha, sem `<` e `>` (nada que feche ou abra uma marcação), espaços juntos e cortado
 * em `limite` caracteres. O prompt ainda diz que isto são dados, nunca instruções.
 */
export function limparParaPrompt(texto: string | null | undefined, limite: number): string {
  const limpo = (texto ?? "").replace(/[<>]/g, " ").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return limpo.length > limite ? limpo.slice(0, limite).trimEnd() : limpo;
}

/** Como `limparParaPrompt`, e troca as aspas por apóstrofo: o texto de fora entra dentro de uma tag, como dado, e uma aspa solta não fecha nem abre nada. */
export function limparParaPromptSemAspas(texto: string | null | undefined, limite: number): string {
  return limparParaPrompt(texto, limite).replace(/["“”]/g, "'");
}

export const LIMITE_DO_TITULO = 200;
export const LIMITE_DO_VEICULO = 60;
