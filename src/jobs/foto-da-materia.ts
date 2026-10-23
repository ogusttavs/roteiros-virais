/**
 * A foto da matéria (fix de 22/10/2026, Notícias): do link que o Google News devolve até os bytes da foto que o veículo pôs na página (`og:image` ou `twitter:image`).
 *
 * Três passos, cada um com prazo curto e teto de bytes, e cada um por uma rede que nunca confia no endereço: o link e a foto vêm de fora (feed e página de terceiros), então tudo passa por
 * `lerComGuarda` (só https na porta 443, sem credencial, sem IP direto, DNS que só aceita IP público, no máximo 3 redirecionamentos conferidos um a um). Diferente da lista curada de portais
 * (`busca-segura.hostEhDeVeiculoCurado`, que é só para os feeds dos assuntos), aqui o veículo é qualquer um que o Google News indexe, então o host é aberto e quem protege a rede interna é o
 * DNS (um nome que resolve para `10.x`, `127.x` ou o `roteiros-postgres` do Docker é recusado na conexão).
 *
 *  1. `resolverLinkDoGoogleNews`: o link `news.google.com/rss/articles/<id>` não é a matéria. A página do Google traz uma assinatura e um carimbo de hora (`data-n-a-sg`, `data-n-a-ts`); com
 *     eles, um POST ao `batchexecute` do próprio Google devolve o endereço de verdade. Frágil por natureza (é um endereço interno do Google): se mudar, a função devolve nulo e a notícia fica
 *     com o quadro do nome do veículo, nunca com erro.
 *  2. `buscarPaginaDaMateria` e `fotoDaPagina`: lê o começo da página (o `<head>` basta) e escolhe a foto.
 *  3. `baixarFotoDaMateria`: baixa a foto até o teto (acima dele descarta, nunca corta), confere pelos PRIMEIROS BYTES se é JPEG, PNG ou WebP (o cabeçalho de tipo não vale: SVG e HTML disfarçados
 *     são recusados) e devolve o tipo certo.
 *
 * Sem rede nos testes: os três passos aceitam o transporte (`buscar`/`postar`) por parâmetro.
 */
import { fetch as undiciFetch, type Agent } from "undici";

import { lerComGuarda } from "./busca-segura";
import { criarAgenteSeguro, type BuscarLeitor } from "./site-api";

export const HOST_DO_GOOGLE_NEWS = "news.google.com";
const ENDERECO_DA_RESOLUCAO = "https://news.google.com/_/DotsSplashUi/data/batchexecute";

/** A foto de uma matéria raramente passa de 300 KB; 1,5 MB deixa passar a grande de capa sem deixar o banco inchar. */
export const LIMITE_BYTES_DA_FOTO = 1_500_000;
/** Abaixo disto é pixel de rastreio ou ícone, não foto. */
export const MINIMO_BYTES_DA_FOTO = 4_000;
/** O `<head>` com as metatags cabe nos primeiros 400 KB de qualquer página de veículo. */
const BYTES_DA_PAGINA = 400_000;
/** A página do Google News pesa uns 590 KB e a assinatura vem no fim dela. */
const BYTES_DA_PAGINA_DO_GOOGLE = 1_500_000;
const BYTES_DA_RESPOSTA_DA_RESOLUCAO = 100_000;

export type TipoDeFoto = "image/jpeg" | "image/png" | "image/webp";

/* ------------------------------------------------------------------ */
/* Puras                                                               */
/* ------------------------------------------------------------------ */

/** O tipo da imagem pelos primeiros bytes. Só JPEG, PNG e WebP; o resto (inclusive SVG e GIF) é nulo. */
export function tipoDaFoto(bytes: Uint8Array): TipoDeFoto | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Os atributos de uma tag, com o nome em minúscula. */
function atributosDaTag(tag: string): Map<string, string> {
  const atributos = new Map<string, string>();
  const regex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let achado: RegExpExecArray | null;
  while ((achado = regex.exec(tag)) !== null) {
    const nome = achado[1].toLowerCase();
    if (!atributos.has(nome)) atributos.set(nome, achado[2] ?? achado[3] ?? achado[4] ?? "");
  }
  return atributos;
}

/** A ordem de preferência das metatags: a versão https do `og:image` primeiro, depois o `og:image`, depois o `twitter:image`. */
const CHAVES_DE_FOTO = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"];

/**
 * Um endereço de foto da página, absoluto e https, ou nulo. Resolve o relativo contra `base`, tira as entidades do HTML, sobe `http` para `https` (muitos veículos ainda põem `http` na metatag; a
 * conexão a esse endereço continua passando pela guarda), e recusa o que não é uma foto de verdade: `data:`, SVG, endereço grande demais, IP direto.
 */
export function enderecoDeFoto(bruto: string | null | undefined, base: string): string | null {
  if (!bruto) return null;
  const texto = decodificarEntidades(bruto).trim();
  if (!texto || texto.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(texto, base);
  } catch {
    return null;
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (/\.svg$/i.test(url.pathname)) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(host) || host.includes(":")) return null;
  return url.href;
}

/**
 * A foto que o veículo escolheu para a matéria: `og:image` (ou o equivalente) das metatags da página, na ordem de `CHAVES_DE_FOTO`, resolvida contra o endereço da página. Sem metatag, o
 * `<link rel="image_src">` antigo. Nulo se a página não tem foto que sirva.
 */
export function fotoDaPagina(html: string, enderecoDaPagina: string): string | null {
  const porChave = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const atributos = atributosDaTag(tag);
    const chave = (atributos.get("property") ?? atributos.get("name") ?? atributos.get("itemprop") ?? "").toLowerCase();
    const conteudo = atributos.get("content");
    if (chave && conteudo && CHAVES_DE_FOTO.includes(chave) && !porChave.has(chave)) porChave.set(chave, conteudo);
  }
  for (const chave of CHAVES_DE_FOTO) {
    const endereco = enderecoDeFoto(porChave.get(chave), enderecoDaPagina);
    if (endereco) return endereco;
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const atributos = atributosDaTag(tag);
    if ((atributos.get("rel") ?? "").toLowerCase() === "image_src") {
      const endereco = enderecoDeFoto(atributos.get("href"), enderecoDaPagina);
      if (endereco) return endereco;
    }
  }
  return null;
}

/** O id do artigo num link do Google News (`/rss/articles/<id>` ou `/articles/<id>`), ou nulo se o link não é do Google News. */
export function idDoArtigoDoGoogleNews(link: string): string | null {
  try {
    const url = new URL(link);
    if (url.hostname !== HOST_DO_GOOGLE_NEWS) return null;
    const achado = /^\/(?:rss\/)?(?:read|articles)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
    return achado ? achado[1] : null;
  } catch {
    return null;
  }
}

/** A assinatura e o carimbo de hora que a página do artigo no Google News traz para o pedido de resolução. */
export function assinaturaDaPaginaDoGoogle(html: string): { id: string; ts: string; sg: string } | null {
  const id = /data-n-a-id="([^"]+)"/.exec(html)?.[1];
  const ts = /data-n-a-ts="([^"]+)"/.exec(html)?.[1];
  const sg = /data-n-a-sg="([^"]+)"/.exec(html)?.[1];
  return id && ts && sg && /^\d+$/.test(ts) ? { id, ts, sg } : null;
}

/** O corpo (formulário) do pedido de resolução ao `batchexecute` do Google News. */
export function corpoDoPedidoDeResolucao(a: { id: string; ts: string; sg: string }): string {
  const interno = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],${JSON.stringify(a.id)},${a.ts},${JSON.stringify(a.sg)}]`;
  const pedido = [[["Fbv4je", interno, null, "generic"]]];
  return `f.req=${encodeURIComponent(JSON.stringify(pedido))}`;
}

/** O endereço (ainda por conferir) dentro da resposta do `batchexecute` (`)]}'` seguido de JSON), ou nulo se a resposta não tem. */
export function enderecoDaRespostaDeResolucao(texto: string): string | null {
  try {
    const json = JSON.parse(texto.replace(/^\)\]\}'\s*/, "")) as unknown;
    if (!Array.isArray(json)) return null;
    for (const linha of json) {
      if (!Array.isArray(linha) || linha[0] !== "wrb.fr" || typeof linha[2] !== "string") continue;
      const interno = JSON.parse(linha[2]) as unknown;
      if (Array.isArray(interno) && interno[0] === "garturlres" && typeof interno[1] === "string") {
        return interno[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Host de uma página de veículo: com ponto, sem nome de rede interna. A guarda de IP da conexão faz o resto. */
export function hostDeVeiculoPermitido(host: string): boolean {
  const h = host.toLowerCase();
  if (!h.includes(".")) return false;
  if (/\.(local|localhost|internal|lan|home|corp|intranet|test|invalid|example)$/.test(h)) return false;
  // O Google News é o redirecionador, nunca a matéria.
  if (h === HOST_DO_GOOGLE_NEWS || h.endsWith(".google.com")) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Rede                                                                */
/* ------------------------------------------------------------------ */

export type TransporteDaFoto = {
  /** Substitui o transporte dos GET (testes). */
  buscar?: BuscarLeitor;
  /** Substitui o POST da resolução (testes): recebe o endereço e o corpo do formulário, devolve o texto da resposta. */
  postar?: (url: string, corpo: string) => Promise<string>;
};

let agenteDoPost: Agent | null = null;

async function postarFormulario(url: string, corpo: string): Promise<string> {
  agenteDoPost ??= criarAgenteSeguro({ conexaoMs: 5_000, requisicaoMs: 10_000 });
  const resposta = await undiciFetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": "Mozilla/5.0 (compatible; Klaki/1.0; leitor de feeds)" },
    body: corpo,
    redirect: "error",
    dispatcher: agenteDoPost,
    signal: AbortSignal.timeout(10_000),
  });
  if (resposta.status < 200 || resposta.status >= 300) {
    await resposta.body?.cancel().catch(() => undefined);
    throw new Error(`o Google News respondeu ${resposta.status}`);
  }
  if (!resposta.body) return "";
  const leitor = resposta.body.getReader();
  const pedacos: Uint8Array[] = [];
  let lidos = 0;
  while (lidos < BYTES_DA_RESPOSTA_DA_RESOLUCAO) {
    const { done, value } = await leitor.read();
    if (done || !value) break;
    pedacos.push(value);
    lidos += value.length;
  }
  await leitor.cancel().catch(() => undefined);
  return new TextDecoder("utf-8").decode(Buffer.concat(pedacos));
}

/**
 * Do link do Google News ao endereço da matéria no veículo. Link que já não é do Google News volta como está. Nulo quando não deu (a página do Google mudou, a rede falhou, o prazo estourou):
 * quem chamou deixa a notícia sem foto, sem erro.
 */
export async function resolverLinkDoGoogleNews(link: string, transporte: TransporteDaFoto = {}): Promise<string | null> {
  const id = idDoArtigoDoGoogleNews(link);
  if (!id) return link;
  try {
    const pagina = await lerComGuarda(`https://${HOST_DO_GOOGLE_NEWS}/rss/articles/${id}?hl=pt-BR&gl=BR&ceid=BR:pt-419`, {
      aceita: "text/html",
      limiteBytes: BYTES_DA_PAGINA_DO_GOOGLE,
      tempoMs: 10_000,
      hostPermitido: (host) => host === HOST_DO_GOOGLE_NEWS,
      buscar: transporte.buscar,
    });
    const assinatura = assinaturaDaPaginaDoGoogle(new TextDecoder("utf-8").decode(pagina.bytes));
    if (!assinatura) return null;
    const resposta = await (transporte.postar ?? postarFormulario)(ENDERECO_DA_RESOLUCAO, corpoDoPedidoDeResolucao(assinatura));
    const endereco = enderecoDaRespostaDeResolucao(resposta);
    const seguro = enderecoDeFoto(endereco, "https://exemplo.invalido/");
    // `enderecoDeFoto` serve de conferência de https e de endereço (a matéria nunca é SVG, mas também nunca é IP); o que volta é o endereço da matéria, não da foto.
    return seguro && hostDeVeiculoPermitido(new URL(seguro).hostname) ? seguro : null;
  } catch {
    return null;
  }
}

/** O começo do HTML da página da matéria (o `<head>` basta), ou nulo se não respondeu. */
export async function buscarPaginaDaMateria(endereco: string, transporte: TransporteDaFoto = {}): Promise<{ html: string; enderecoFinal: string } | null> {
  try {
    const { bytes, enderecoFinal } = await lerComGuarda(endereco, {
      aceita: "text/html",
      limiteBytes: BYTES_DA_PAGINA,
      tempoMs: 8_000,
      hostPermitido: hostDeVeiculoPermitido,
      buscar: transporte.buscar,
    });
    // O endereço de depois dos redirecionamentos: um `og:image` relativo se resolve contra ele (o veículo pode redirecionar para outro domínio).
    return { html: new TextDecoder("utf-8").decode(bytes), enderecoFinal };
  } catch {
    return null;
  }
}

/** Baixa a foto: até `LIMITE_BYTES_DA_FOTO` (acima disso nada é guardado), tipo conferido pelos bytes. Nulo quando não serve. */
export async function baixarFotoDaMateria(endereco: string, transporte: TransporteDaFoto = {}): Promise<{ bytes: Uint8Array; tipo: TipoDeFoto } | null> {
  try {
    const { bytes, truncado } = await lerComGuarda(endereco, {
      aceita: "image/jpeg,image/png,image/webp",
      limiteBytes: LIMITE_BYTES_DA_FOTO + 1,
      tempoMs: 10_000,
      hostPermitido: hostDeVeiculoPermitido,
      buscar: transporte.buscar,
    });
    if (truncado || bytes.length > LIMITE_BYTES_DA_FOTO || bytes.length < MINIMO_BYTES_DA_FOTO) return null;
    const tipo = tipoDaFoto(bytes);
    return tipo ? { bytes, tipo } : null;
  } catch {
    return null;
  }
}

export type ResultadoDaFoto =
  | { situacao: "guardada"; bytes: Uint8Array; tipo: TipoDeFoto; origem: string }
  | { situacao: "sem_foto"; motivo: string; passageiro: boolean };

/**
 * O caminho inteiro de uma notícia: link do Google News, página, foto, bytes. `passageiro` diz se vale tentar de novo mais tarde (a rede falhou) ou não (a página abriu e não tem foto que sirva).
 */
export async function fotoDaMateria(linkDaNoticia: string, transporte: TransporteDaFoto = {}): Promise<ResultadoDaFoto> {
  const endereco = await resolverLinkDoGoogleNews(linkDaNoticia, transporte);
  if (!endereco) return { situacao: "sem_foto", motivo: "nao_resolveu_o_link", passageiro: true };
  if (!hostDeVeiculoPermitido(safeHost(endereco))) return { situacao: "sem_foto", motivo: "host_recusado", passageiro: false };

  const pagina = await buscarPaginaDaMateria(endereco, transporte);
  if (!pagina) return { situacao: "sem_foto", motivo: "pagina_nao_abriu", passageiro: true };

  const origem = fotoDaPagina(pagina.html, pagina.enderecoFinal);
  if (!origem) return { situacao: "sem_foto", motivo: "pagina_sem_foto", passageiro: false };

  const foto = await baixarFotoDaMateria(origem, transporte);
  if (!foto) return { situacao: "sem_foto", motivo: "foto_nao_serve", passageiro: false };
  return { situacao: "guardada", bytes: foto.bytes, tipo: foto.tipo, origem };
}

function safeHost(endereco: string): string {
  try {
    return new URL(endereco).hostname;
  } catch {
    return "";
  }
}
