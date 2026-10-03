/**
 * Leitor seguro do site público de uma marca (E38, PR 2): lê até cinco páginas de um
 * endereço que a MARCA digitou, para uma IA resumir. É o primeiro código do projeto que
 * busca uma URL escolhida por um usuário, então SSRF é a preocupação número 1: o worker
 * enxerga o `roteiros-postgres`, o `roteiros-pot`, o `roteiros-app`, o gateway da ponte
 * Docker e o endereço de metadados de nuvem, e o que ele lê volta para a tela do cliente
 * (resposta refletida é o que torna isso grave).
 *
 * As defesas, em camadas:
 * 1. `validarUrlDeLeitura` (site-extrair.ts): só https, porta 443, sem usuário e senha, nome
 *    com ponto, IP literal só se público. Vale para o endereço salvo, cada salto e cada link.
 * 2. `lookupSeguro` no caminho de conexão: o nome é resolvido uma vez, o IP é conferido
 *    (`enderecoEhPublico`) e é esse mesmo endereço que o soquete usa. Fecha o DNS
 *    rebinding (conferir antes e conectar depois deixaria uma janela). Recusa se ALGUM dos
 *    endereços for privado. Host que já é IP literal não passa pelo `lookup`, por isso a
 *    camada 1 o confere antes de qualquer conexão.
 * 3. Redirecionamento manual, no máximo 3 saltos, cada salto revalidado; trocar de host só
 *    é aceito na PRIMEIRA página (o cliente digitou aquele endereço; o host final vira o
 *    host permitido). Nunca segue link externo.
 * 4. Corpo lido em stream, com teto por página e total, recusa de Content-Length enorme,
 *    só HTML, e cancelamento do stream ao estourar (o `undici` descomprime antes do stream,
 *    então o teto também protege de bomba de descompressão).
 * 5. O CUSTO de CPU do que chega. O worker é um processo só e o parse5 é síncrono (nenhum prazo o
 *    interrompe), então `site-extrair.ts` limita o trabalho ANTES de entregar o texto de terceiros
 *    ao parser e às regras do robots.txt (teto de `<` por documento, de atributos por tag, de
 *    elementos de formatação, de regras e de curingas do robots.txt, de nós por conferência), com
 *    o pior caso por página medido e anotado lá. Aqui basta respeitar os tetos de bytes e de
 *    requisições da camada 4: o corpo é decodificado inteiro e entregue de uma vez àquelas funções.
 *
 * Comportamento com o site, sem exceção: User-Agent honesto (montado de `APP_NAME`,
 * `APP_URL` e `EMAIL_CONTATO`), nenhum cookie, nenhum `Authorization`, nunca proxy (o proxy
 * resolveria o DNS e a guarda de IP deixaria de valer, e proxy custa por gigabyte), nunca
 * disfarçar de navegador e nunca tentar de novo com outro User-Agent quando vier 401, 403,
 * 429 ou tela de desafio: o motivo é registrado e a rodada para. Cada página é pedida no
 * formato em que o site escreveu o link (com ou sem a barra final): pedir `/sobre` quando o
 * WordPress escreve `/sobre/` custa um redirecionamento por página, e o teto de requisições
 * corta páginas (o motivo é `limite_de_requisicoes`). Respeita o robots.txt
 * (RFC 9309; erro 5xx ou tempo esgotado do robots vale como "proibido"). Sem navegador sem
 * cabeça: site que só carrega por JavaScript cai no motivo `sem_texto`.
 *
 * `lerSiteDaMarca` NUNCA lança por falha esperada (bloqueio, 404, tempo, IP privado, robots,
 * não é HTML, grande demais): devolve `motivoGeral` e a lista `ignoradas` com o motivo por
 * endereço. A fila curta do job repete quem lança (até 3 vezes), e cada repetição leria o
 * site do cliente de novo. Mantenha este arquivo fora do que o `src/app` importa: ele arrasta
 * o parse5 e o undici para o bundle web.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";

import { Agent, fetch as undiciFetch } from "undici";

import { config } from "@/lib/config";
import { enderecoEhPublico } from "@/lib/ip-publico";
import { logger } from "@/lib/log";

import {
  aplicarTetosDeTexto,
  analisarRobots,
  classificarCandidatos,
  decodificarCorpo,
  ehPaginaDeDesafio,
  ehRedeSocialOuLinkHub,
  escolherSitemapFilho,
  extrairDoHtml,
  extrairLocsDeSitemap,
  hashDoTexto,
  mesmoSite,
  MINIMO_TEXTO_UTIL,
  normalizarUrlDoSite,
  removerLinhasRepetidasEntrePaginas,
  robotsPermiteTudo,
  selecionarPorOrcamento,
  textoInsuficiente,
  validarUrlDeLeitura,
  type ExtracaoHtml,
  type RegrasRobots,
} from "./site-extrair";

/* ------------------------------------------------------------------ */
/* Tipos públicos                                                      */
/* ------------------------------------------------------------------ */

export type MotivoLeituraSite =
  | "endereco_invalido"
  | "endereco_privado"
  | "rede_social"
  | "robots_proibe"
  | "robots_indisponivel"
  | "bloqueado_pelo_site"
  | "nao_encontrado"
  | "erro_do_site"
  | "tempo_esgotado"
  | "grande_demais"
  | "nao_e_html"
  | "sem_texto"
  | "redirecionamento_invalido"
  | "sem_resposta"
  /**
   * Acrescentado ao fim da união (E38 PR 2, revisão): a leitura gastou o teto de requisições
   * (robots.txt, saltos e páginas contam) antes de pedir esta página. Antes era `grande_demais`,
   * que na tela diz "não conseguimos tirar o texto dele" e engana. Quem recebe um motivo que não
   * conhece usa a frase padrão (`fraseDaFonteNaoLida`).
   */
  | "limite_de_requisicoes";

/** Falha esperada de leitura: carrega o `motivo` que a leitura devolve e que a tela explica. */
export class ErroLeituraSite extends Error {
  constructor(
    readonly motivo: MotivoLeituraSite,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroLeituraSite";
  }
}

export type PaginaLida = {
  url: string;
  status: number;
  /** Bytes do corpo lidos (já descomprimidos), antes de virar texto. */
  bytes: number;
  /** O corpo passou do teto por página (ou do teto total) e foi cortado. */
  truncada: boolean;
  titulo: string | null;
  descricao: string | null;
  /** Texto limpo e limitado (6.000 por página, 20.000 no total), pronto para o modelo. */
  texto: string;
  /** sha256 do texto normalizado, para a detecção de "mudou" no refeito mensal. */
  hash: string;
};

export type ResultadoLeituraSite = {
  /** O endereço salvo, normalizado (ou o texto cru, se nem URL era). */
  urlInicial: string;
  /** O host em que a primeira página terminou (depois dos redirecionamentos). */
  hostFinal: string | null;
  paginas: PaginaLida[];
  ignoradas: { url: string; motivo: MotivoLeituraSite }[];
  bytesTotais: number;
  requisicoes: number;
  /**
   * Por que a leitura não rendeu: `null` quando saiu texto suficiente. Com `sem_texto`,
   * `paginas` ainda traz o pouco que houve.
   */
  motivoGeral: MotivoLeituraSite | null;
};

export type LimitesLeitor = {
  /** Páginas HTML lidas, contando a home. */
  maxPaginas: number;
  /** Requisições por leitura, contando robots.txt, sitemap, saltos e 404. */
  maxRequisicoes: number;
  maxSaltos: number;
  bytesPorPagina: number;
  bytesTotais: number;
  /** Content-Length declarado acima disto: recusa sem ler. */
  contentLengthMaximo: number;
  robotsBytes: number;
  sitemapBytes: number;
  /** Cabeçalho mais corpo de uma requisição. */
  tempoRequisicaoMs: number;
  tempoTotalMs: number;
  conexaoMs: number;
  /** Pausa entre uma requisição e a seguinte. */
  pausaMs: number;
};

export const LIMITES_PADRAO: LimitesLeitor = {
  maxPaginas: 5,
  maxRequisicoes: 10,
  maxSaltos: 3,
  bytesPorPagina: 1024 * 1024,
  bytesTotais: 4 * 1024 * 1024,
  contentLengthMaximo: 5 * 1024 * 1024,
  robotsBytes: 512 * 1024,
  sitemapBytes: 1024 * 1024,
  tempoRequisicaoMs: 10_000,
  tempoTotalMs: 40_000,
  conexaoMs: 5_000,
  pausaMs: 500,
};

export type PedidoLeitor = {
  method: "GET";
  headers: Record<string, string>;
  redirect: "manual";
  signal: AbortSignal;
};

/** O que o leitor usa de uma resposta: um `Response` do fetch serve. */
export type RespostaLeitor = Pick<Response, "status" | "headers" | "body">;

/** Compatível com `fetch`: recebe o endereço e o `init` (sempre com `signal` e `redirect: "manual"`). */
export type BuscarLeitor = (url: string, init: PedidoLeitor) => Promise<RespostaLeitor>;

/** A parte do `dns.lookup` que o leitor usa; injetável para testar sem DNS de verdade. */
export type ResolverDns = (
  host: string,
  opcoes: { all: true; verbatim: true; family?: number; hints?: number },
  callback: (erro: NodeJS.ErrnoException | null, enderecos: LookupAddress[]) => void,
) => void;

export type OpcoesLeitor = {
  /** Substitui o transporte inteiro (testes). Sem isto, usa o fetch do undici com a guarda de IP. */
  buscar?: BuscarLeitor;
  /** O `dns.lookup` que a guarda de IP envolve. Só vale com o transporte padrão. */
  resolver?: ResolverDns;
  /** Pausa entre requisições; injetável para o teste não esperar de verdade. */
  esperar?: (ms: number) => Promise<void>;
  limites?: Partial<LimitesLeitor>;
  userAgent?: string;
};

/* ------------------------------------------------------------------ */
/* Guarda de IP no caminho de conexão                                  */
/* ------------------------------------------------------------------ */

/**
 * O `lookup` do soquete. `dns.lookup` (getaddrinfo, e não `dns.resolve*`) para ver as mesmas
 * respostas que a conexão usaria, inclusive `/etc/hosts` e os apelidos de serviço do Docker.
 * Recusa se ALGUM endereço devolvido for privado (resposta mista é suspeita), em vez de só
 * filtrar os privados. Sempre pede `all: true` ao resolvedor: com `autoSelectFamily` o Node
 * chama com `all: true` e espera uma lista (devolver um endereço só quebra a conexão).
 */
export function criarLookupSeguro(
  resolver: ResolverDns = dnsLookup as unknown as ResolverDns,
): LookupFunction {
  return (host, opcoes, callback) => {
    const familia = opcoes.family === "IPv4" ? 4 : opcoes.family === "IPv6" ? 6 : opcoes.family;
    const pedido = {
      all: true as const,
      verbatim: true as const,
      ...(typeof familia === "number" ? { family: familia } : {}),
      ...(typeof opcoes.hints === "number" ? { hints: opcoes.hints } : {}),
    };
    resolver(host, pedido, (erro, enderecos) => {
      if (erro) {
        callback(erro, []);
        return;
      }
      const lista = enderecos ?? [];
      if (lista.length === 0 || lista.some((endereco) => !enderecoEhPublico(endereco.address))) {
        callback(
          new ErroLeituraSite("endereco_privado", `${host} resolve para endereco nao publico`),
          [],
        );
        return;
      }
      if (opcoes.all) callback(null, lista);
      else callback(null, lista[0].address, lista[0].family);
    });
  };
}

/** O `Agent` que toda requisição real usa: conexão com a guarda de IP e prazos curtos (os padrões do undici são 300 s). */
export function criarAgenteSeguro(
  opcoes: { resolver?: ResolverDns; conexaoMs?: number; requisicaoMs?: number } = {},
): Agent {
  const requisicaoMs = opcoes.requisicaoMs ?? LIMITES_PADRAO.tempoRequisicaoMs;
  return new Agent({
    connect: {
      lookup: criarLookupSeguro(opcoes.resolver),
      timeout: opcoes.conexaoMs ?? LIMITES_PADRAO.conexaoMs,
    },
    headersTimeout: requisicaoMs,
    bodyTimeout: requisicaoMs,
    keepAliveTimeout: 1_000,
  });
}

/* ------------------------------------------------------------------ */
/* Identificação                                                       */
/* ------------------------------------------------------------------ */

function soAscii(texto: string): string {
  return texto.replace(/[^\x21-\x7E]/g, "");
}

/**
 * User-Agent honesto, sem se passar por navegador: `<nome>-Leitor/1.0 (+<endereço do app>;
 * <e-mail de contato>)`. O nome vem de `APP_NAME` (nunca fixo em código), higienizado para
 * virar um token válido de cabeçalho; o token (sem a versão) é o que o robots.txt enxerga.
 */
export function montarUserAgent(): { token: string; cabecalho: string } {
  const nome = config.appName.replace(/[^A-Za-z0-9.+_-]/g, "");
  const token =
    nome === "" ? "Leitor" : nome.toLowerCase().endsWith("-leitor") ? nome : `${nome}-Leitor`;
  const contato = [soAscii(config.appUrl), soAscii(config.emailContato)].filter(Boolean);
  const cabecalho = `${token}/1.0 (+${contato.join("; ")})`;
  return { token, cabecalho };
}

/* ------------------------------------------------------------------ */
/* Peças de transporte                                                 */
/* ------------------------------------------------------------------ */

const CODIGOS_DE_TEMPO = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ETIMEDOUT",
]);

const CODIGOS_SEM_RESPOSTA = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_FAIL",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "EPROTO",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "UND_ERR_DESTROYED",
  "UND_ERR_ABORTED",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_PACKET_LENGTH_TOO_LONG",
]);

type ComCausa = { cause?: unknown; errors?: unknown; code?: unknown; name?: unknown };

/** Anda pela cadeia de `cause` (e pelos `errors` de um AggregateError) atrás de um erro nosso. */
function acharErroLeituraSite(erro: unknown): ErroLeituraSite | null {
  let atual: unknown = erro;
  for (let i = 0; i < 6 && atual; i += 1) {
    if (atual instanceof ErroLeituraSite) return atual;
    const bloco = atual as ComCausa;
    if (Array.isArray(bloco.errors)) {
      for (const interno of bloco.errors.slice(0, 5)) {
        const achado = acharErroLeituraSite(interno);
        if (achado) return achado;
      }
    }
    atual = bloco.cause;
  }
  return null;
}

function codigoDe(erro: unknown): string | null {
  let atual: unknown = erro;
  for (let i = 0; i < 6 && atual; i += 1) {
    const codigo = (atual as ComCausa).code;
    if (typeof codigo === "string") return codigo;
    atual = (atual as ComCausa).cause;
  }
  return null;
}

/** Rejeita assim que o sinal dispara, mesmo que a promessa original (de um `buscar` que ignora o sinal) nunca resolva. */
function aguardarOuAbortar<T>(promessa: Promise<T>, sinal: AbortSignal): Promise<T> {
  if (sinal.aborted) return Promise.reject(sinal.reason);
  return new Promise<T>((resolve, reject) => {
    const aoAbortar = () => reject(sinal.reason);
    sinal.addEventListener("abort", aoAbortar, { once: true });
    promessa.then(
      (valor) => {
        sinal.removeEventListener("abort", aoAbortar);
        resolve(valor);
      },
      (erro) => {
        sinal.removeEventListener("abort", aoAbortar);
        reject(erro);
      },
    );
  });
}

function cancelarCorpo(resposta: RespostaLeitor): void {
  try {
    void resposta.body?.cancel().catch(() => undefined);
  } catch {
    /* corpo ja travado ou encerrado */
  }
}

/**
 * Lê o corpo em stream, somando bytes. Passou de `limite`: guarda só até o limite, marca
 * `truncada` e cancela o stream (nunca `await resposta.text()`). Cancela também se o sinal
 * disparar ou der erro. Corpo que trava no meio é derrubado pelo sinal.
 */
async function lerCorpoLimitado(
  corpo: ReadableStream<Uint8Array> | null,
  limite: number,
  sinal: AbortSignal,
): Promise<{ bytes: Uint8Array; truncada: boolean }> {
  if (!corpo) return { bytes: new Uint8Array(0), truncada: false };
  const leitor = corpo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  let truncada = false;
  let terminou = false;
  try {
    for (;;) {
      const { done, value } = await aguardarOuAbortar(leitor.read(), sinal);
      if (done) {
        terminou = true;
        break;
      }
      if (!value || value.byteLength === 0) continue;
      if (total + value.byteLength > limite) {
        const resta = Math.max(limite - total, 0);
        if (resta > 0) partes.push(value.subarray(0, resta));
        total += resta;
        truncada = true;
        break;
      }
      partes.push(value);
      total += value.byteLength;
    }
  } finally {
    if (!terminou) void leitor.cancel().catch(() => undefined);
  }
  return { bytes: Buffer.concat(partes), truncada };
}

function motivoDoStatus(status: number): MotivoLeituraSite {
  if (status === 401 || status === 403 || status === 429 || status === 451)
    return "bloqueado_pelo_site";
  if (status === 404 || status === 410) return "nao_encontrado";
  return "erro_do_site";
}

/** Sitemap `.gz` não é lido (descomprimir é trabalho que o leitor não faz): sem regex, o caminho é de terceiros. */
function ehSitemapComprimido(url: URL): boolean {
  return url.pathname.toLowerCase().endsWith(".gz");
}

const TIPOS_DE_HTML = new Set(["text/html", "application/xhtml+xml"]);

function comecaComMenor(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (
    i < bytes.length &&
    (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)
  )
    i += 1;
  return i < bytes.length && bytes[i] === 0x3c;
}

type TipoDeCorpo = "html" | "texto" | "xml";

type Baixada =
  | { tipo: "redirecionamento"; status: number; location: string | null }
  | { tipo: "erro"; status: number }
  | {
      tipo: "ok";
      status: number;
      contentType: string | null;
      bytes: Uint8Array;
      truncada: boolean;
    };

type PoliticaDeSalto = {
  /** O host que as páginas seguintes precisam ter (a variante com ou sem www vale). */
  hostPermitido: () => string;
  permiteOutroHost: boolean;
  aoMudarDeHost?: (host: string) => void;
  /** Roda antes de cada requisição de conteúdo (o robots.txt do host); lança `ErroLeituraSite` para recusar. */
  aoChegarNoHost?: (url: URL) => Promise<void>;
  corpo: { tipo: TipoDeCorpo; limiteBytes: number };
};

/* ------------------------------------------------------------------ */
/* A leitura                                                           */
/* ------------------------------------------------------------------ */

type PaginaBaixada = {
  url: string;
  status: number;
  bytes: number;
  truncada: boolean;
  extracao: ExtracaoHtml;
  ehHome: boolean;
};

/**
 * Lê o site de uma marca: a home e até quatro páginas do mesmo site (uma de "sobre", até
 * duas de produtos ou serviços e uma de contato, FAQ ou depoimentos), sempre uma requisição
 * por vez, com pausa. Nunca lança por falha esperada; ver o cabeçalho do arquivo.
 */
export async function lerSiteDaMarca(
  urlSalva: string,
  opcoes: OpcoesLeitor = {},
): Promise<ResultadoLeituraSite> {
  const limites: LimitesLeitor = { ...LIMITES_PADRAO, ...opcoes.limites };
  const resultado: ResultadoLeituraSite = {
    urlInicial: urlSalva.trim(),
    hostFinal: null,
    paginas: [],
    ignoradas: [],
    bytesTotais: 0,
    requisicoes: 0,
    motivoGeral: null,
  };

  const normalizada = normalizarUrlDoSite(urlSalva);
  if (!normalizada.ok) {
    resultado.motivoGeral = normalizada.motivo;
    return resultado;
  }
  resultado.urlInicial = normalizada.url;
  resultado.hostFinal = normalizada.host;

  const identidade = montarUserAgent();
  const userAgent = opcoes.userAgent ?? identidade.cabecalho;
  const tokenDoAgente = opcoes.userAgent
    ? (opcoes.userAgent.split(/[\s/]/)[0] ?? identidade.token)
    : identidade.token;
  const esperar =
    opcoes.esperar ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const agente = opcoes.buscar
    ? null
    : criarAgenteSeguro({
        resolver: opcoes.resolver,
        conexaoMs: limites.conexaoMs,
        requisicaoMs: limites.tempoRequisicaoMs,
      });
  const buscar: BuscarLeitor =
    opcoes.buscar ??
    ((url, init) =>
      undiciFetch(url, {
        ...init,
        dispatcher: agente as Agent,
      }) as unknown as Promise<RespostaLeitor>);

  const sinalTotal = AbortSignal.timeout(limites.tempoTotalMs);
  let hostPermitido = normalizada.host;
  let parar = false;
  const regrasPorHost = new Map<string, RegrasRobots>();

  /**
   * Traduz uma falha de rede (do `buscar` ou da leitura do corpo) num `ErroLeituraSite`: o que já é
   * nosso passa direto (inclusive o que o `lookupSeguro` lançou dentro do fetch); prazo estourado
   * vira `tempo_esgotado`; falha de conexão conhecida vira `sem_resposta`. O que não é conhecido é
   * registrado (com o erro, nunca com o texto das páginas) e também vira `sem_resposta`.
   */
  function traduzirErroDeRede(erro: unknown): ErroLeituraSite {
    const nosso = acharErroLeituraSite(erro);
    if (nosso) return nosso;
    const nome = (erro as ComCausa | null)?.name;
    const codigo = codigoDe(erro);
    if (
      nome === "AbortError" ||
      nome === "TimeoutError" ||
      (codigo !== null && CODIGOS_DE_TEMPO.has(codigo))
    ) {
      return new ErroLeituraSite("tempo_esgotado", "o site nao respondeu a tempo");
    }
    if (codigo !== null && CODIGOS_SEM_RESPOSTA.has(codigo)) {
      return new ErroLeituraSite("sem_resposta", `sem resposta do site (${codigo})`);
    }
    logger.error(
      { err: erro, host: hostPermitido },
      "site-api: falha inesperada de rede lendo o site",
    );
    return new ErroLeituraSite("sem_resposta", "falha inesperada ao falar com o site");
  }

  /** O motivo de uma falha de uma página, de um sitemap ou da home; bloqueio para a rodada. */
  function motivoDe(erro: unknown, contexto: string): MotivoLeituraSite {
    const nosso = acharErroLeituraSite(erro);
    let motivo: MotivoLeituraSite;
    if (nosso) {
      motivo = nosso.motivo;
    } else {
      logger.error(
        { err: erro, host: hostPermitido, contexto },
        "site-api: falha inesperada lendo o site",
      );
      motivo = "sem_resposta";
    }
    if (motivo === "bloqueado_pelo_site") parar = true;
    return motivo;
  }

  /** Uma requisição, com todos os tetos, e a leitura do corpo quando a resposta é 2xx. */
  async function baixar(url: URL, corpo: PoliticaDeSalto["corpo"]): Promise<Baixada> {
    if (sinalTotal.aborted)
      throw new ErroLeituraSite("tempo_esgotado", "tempo total da leitura esgotado");
    if (resultado.requisicoes >= limites.maxRequisicoes) {
      throw new ErroLeituraSite("limite_de_requisicoes", "teto de requisicoes da leitura atingido");
    }
    const orcamentoBytes = limites.bytesTotais - resultado.bytesTotais;
    if (orcamentoBytes <= 0)
      throw new ErroLeituraSite("grande_demais", "teto de bytes da leitura atingido");

    if (resultado.requisicoes > 0) await esperar(limites.pausaMs);
    if (sinalTotal.aborted)
      throw new ErroLeituraSite("tempo_esgotado", "tempo total da leitura esgotado");

    resultado.requisicoes += 1;
    const sinal = AbortSignal.any([sinalTotal, AbortSignal.timeout(limites.tempoRequisicaoMs)]);
    const headers: Record<string, string> = {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
    };

    try {
      const resposta = await aguardarOuAbortar(
        buscar(url.href, { method: "GET", headers, redirect: "manual", signal: sinal }),
        sinal,
      );
      const status = resposta.status;

      if (status >= 300 && status < 400) {
        cancelarCorpo(resposta);
        return { tipo: "redirecionamento", status, location: resposta.headers.get("location") };
      }
      /** Cabeçalho de desafio de uma proteção contra bots: é bloqueio, qualquer que seja o status. */
      if (resposta.headers.get("cf-mitigated")?.toLowerCase() === "challenge") {
        cancelarCorpo(resposta);
        throw new ErroLeituraSite(
          "bloqueado_pelo_site",
          "o site respondeu com um desafio de protecao contra robos",
        );
      }
      if (status < 200 || status >= 300) {
        cancelarCorpo(resposta);
        return { tipo: "erro", status };
      }

      const declarado = Number(resposta.headers.get("content-length"));
      if (Number.isFinite(declarado) && declarado > limites.contentLengthMaximo) {
        cancelarCorpo(resposta);
        throw new ErroLeituraSite("grande_demais", "Content-Length acima do teto");
      }

      const contentType = resposta.headers.get("content-type");
      const tipoDeMidia = contentType?.split(";")[0].trim().toLowerCase() ?? null;
      if (corpo.tipo === "html" && tipoDeMidia !== null && !TIPOS_DE_HTML.has(tipoDeMidia)) {
        cancelarCorpo(resposta);
        throw new ErroLeituraSite(
          "nao_e_html",
          `o endereco devolveu ${tipoDeMidia}, nao uma pagina`,
        );
      }

      const lido = await lerCorpoLimitado(
        resposta.body,
        Math.min(corpo.limiteBytes, orcamentoBytes),
        sinal,
      );
      resultado.bytesTotais += lido.bytes.length;
      if (corpo.tipo === "html" && tipoDeMidia === null && !comecaComMenor(lido.bytes)) {
        throw new ErroLeituraSite("nao_e_html", "resposta sem Content-Type e que nao parece HTML");
      }
      return { tipo: "ok", status, contentType, bytes: lido.bytes, truncada: lido.truncada };
    } catch (erro) {
      throw traduzirErroDeRede(erro);
    }
  }

  function resolverLocation(atual: URL, location: string | null): URL {
    if (!location || location.length > 2_048) {
      throw new ErroLeituraSite("redirecionamento_invalido", "redirecionamento sem destino valido");
    }
    try {
      return new URL(location, atual);
    } catch {
      throw new ErroLeituraSite(
        "redirecionamento_invalido",
        "destino de redirecionamento invalido",
      );
    }
  }

  /**
   * Segue a URL e os redirecionamentos, um a um. Cada endereço (o primeiro e cada salto)
   * passa por `validarUrlDeLeitura` ANTES de qualquer conexão, e o IP literal privado nunca
   * chega ao `buscar`. No máximo `maxSaltos` saltos; cada um conta no teto de requisições.
   */
  async function seguir(
    inicial: URL,
    politica: PoliticaDeSalto,
  ): Promise<{ url: URL; baixada: Baixada }> {
    let atual = inicial;
    for (let salto = 0; ; salto += 1) {
      const validada = validarUrlDeLeitura(atual);
      if (!validada.ok) throw new ErroLeituraSite(validada.motivo, validada.detalhe);
      atual = validada.url;

      if (politica.aoChegarNoHost) await politica.aoChegarNoHost(atual);
      const baixada = await baixar(atual, politica.corpo);
      if (baixada.tipo !== "redirecionamento") return { url: atual, baixada };

      if (salto >= limites.maxSaltos) {
        throw new ErroLeituraSite(
          "redirecionamento_invalido",
          `mais de ${limites.maxSaltos} redirecionamentos`,
        );
      }
      const proximo = resolverLocation(atual, baixada.location);
      if (proximo.protocol !== "https:") {
        throw new ErroLeituraSite(
          "redirecionamento_invalido",
          "redirecionamento para fora do https",
        );
      }
      const destino = validarUrlDeLeitura(proximo);
      if (!destino.ok) {
        throw new ErroLeituraSite(
          destino.motivo === "endereco_privado" ? "endereco_privado" : "redirecionamento_invalido",
          destino.detalhe,
        );
      }
      if (!mesmoSite(destino.url.hostname, politica.hostPermitido())) {
        if (!politica.permiteOutroHost) {
          throw new ErroLeituraSite(
            "redirecionamento_invalido",
            "redirecionamento para outro site",
          );
        }
        if (ehRedeSocialOuLinkHub(destino.url.hostname)) {
          throw new ErroLeituraSite(
            "rede_social",
            "o site redireciona para uma rede social ou pagina de links",
          );
        }
        politica.aoMudarDeHost?.(destino.url.hostname);
      }
      atual = destino.url;
    }
  }

  /**
   * As regras do robots.txt do host, buscadas uma vez por host e guardadas. 4xx (404, 401, 403)
   * vale como "sem regras"; 429 é bloqueio; 5xx e tempo esgotado valem como "proibido"
   * (`robots_indisponivel`, RFC 9309). O robots.txt pode redirecionar para outro host: só
   * se leem regras, então a guarda de IP basta.
   */
  async function regrasDoHost(host: string): Promise<RegrasRobots> {
    const chave = host.toLowerCase();
    const guardadas = regrasPorHost.get(chave);
    if (guardadas) return guardadas;

    let regras: RegrasRobots;
    try {
      const { baixada } = await seguir(new URL(`https://${chave}/robots.txt`), {
        hostPermitido: () => chave,
        permiteOutroHost: true,
        corpo: { tipo: "texto", limiteBytes: limites.robotsBytes },
      });
      if (baixada.tipo === "ok") {
        regras = analisarRobots(
          decodificarCorpo(baixada.bytes, baixada.contentType),
          tokenDoAgente,
        );
      } else if (baixada.tipo === "erro" && baixada.status === 429) {
        throw new ErroLeituraSite("bloqueado_pelo_site", "o site limitou as requisicoes (429)");
      } else if (baixada.tipo === "erro" && baixada.status >= 500) {
        throw new ErroLeituraSite("robots_indisponivel", `robots.txt respondeu ${baixada.status}`);
      } else {
        regras = robotsPermiteTudo();
      }
    } catch (erro) {
      const motivo = acharErroLeituraSite(erro)?.motivo;
      if (motivo === "tempo_esgotado" || motivo === "redirecionamento_invalido") {
        throw new ErroLeituraSite(
          "robots_indisponivel",
          "nao foi possivel ler o robots.txt a tempo",
        );
      }
      throw erro;
    }
    regrasPorHost.set(chave, regras);
    return regras;
  }

  async function conferirRobots(url: URL): Promise<void> {
    const regras = await regrasDoHost(url.hostname);
    if (!regras.permite(`${url.pathname}${url.search}`)) {
      throw new ErroLeituraSite(
        "robots_proibe",
        `o robots.txt de ${url.hostname} proibe esta pagina`,
      );
    }
  }

  /** Baixa e lê uma página HTML; qualquer falha esperada vira `ErroLeituraSite`. */
  async function lerPaginaHtml(url: URL, ehHome: boolean): Promise<PaginaBaixada> {
    const { url: finalUrl, baixada } = await seguir(url, {
      hostPermitido: () => hostPermitido,
      permiteOutroHost: ehHome,
      aoMudarDeHost: (host) => {
        hostPermitido = host;
        resultado.hostFinal = host;
      },
      aoChegarNoHost: conferirRobots,
      corpo: { tipo: "html", limiteBytes: limites.bytesPorPagina },
    });
    if (baixada.tipo === "erro") {
      throw new ErroLeituraSite(
        motivoDoStatus(baixada.status),
        `o site respondeu ${baixada.status}`,
      );
    }
    if (baixada.tipo === "redirecionamento") {
      throw new ErroLeituraSite("redirecionamento_invalido", "redirecionamento inesperado");
    }
    const extracao = extrairDoHtml(decodificarCorpo(baixada.bytes, baixada.contentType));
    if (ehPaginaDeDesafio(extracao.titulo, extracao.texto)) {
      throw new ErroLeituraSite(
        "bloqueado_pelo_site",
        "o site respondeu com uma tela de desafio de protecao contra robos",
      );
    }
    finalUrl.hash = "";
    return {
      url: finalUrl.href,
      status: baixada.status,
      bytes: baixada.bytes.length,
      truncada: baixada.truncada,
      extracao,
      ehHome,
    };
  }

  /** Home sem links: tenta o sitemap (o do robots.txt, senão /sitemap.xml; de um índice, um filho só). */
  async function candidatosDoSitemap(homeUrl: URL) {
    const declarados = (await regrasDoHost(homeUrl.hostname)).sitemaps.flatMap((endereco) => {
      try {
        const url = new URL(endereco, homeUrl);
        return url.protocol === "https:" &&
          mesmoSite(url.hostname, hostPermitido) &&
          !ehSitemapComprimido(url)
          ? [url]
          : [];
      } catch {
        return [];
      }
    });
    const primeiro = declarados[0] ?? new URL(`https://${hostPermitido}/sitemap.xml`);

    const lerSitemap = async (url: URL): Promise<{ urls: string[]; ehIndice: boolean } | null> => {
      try {
        const { baixada } = await seguir(url, {
          hostPermitido: () => hostPermitido,
          permiteOutroHost: false,
          corpo: { tipo: "xml", limiteBytes: limites.sitemapBytes },
        });
        if (baixada.tipo !== "ok") {
          resultado.ignoradas.push({
            url: url.href,
            motivo:
              baixada.tipo === "erro"
                ? motivoDoStatus(baixada.status)
                : "redirecionamento_invalido",
          });
          return null;
        }
        return extrairLocsDeSitemap(decodificarCorpo(baixada.bytes, baixada.contentType));
      } catch (erro) {
        resultado.ignoradas.push({ url: url.href, motivo: motivoDe(erro, "sitemap") });
        return null;
      }
    };

    let locs = await lerSitemap(primeiro);
    if (locs?.ehIndice && !parar) {
      const filhos = locs.urls.filter((endereco) => {
        try {
          const url = new URL(endereco);
          return (
            url.protocol === "https:" &&
            mesmoSite(url.hostname, hostPermitido) &&
            !ehSitemapComprimido(url)
          );
        } catch {
          return false;
        }
      });
      const filho = escolherSitemapFilho(filhos);
      locs = filho ? await lerSitemap(new URL(filho)) : null;
    }
    if (!locs || locs.ehIndice) return [];
    return classificarCandidatos(
      locs.urls.map((href) => ({ href, texto: "", emNav: false })),
      homeUrl,
      null,
      hostPermitido,
    );
  }

  try {
    /* A home: se ela falha, a leitura toda falha com o motivo dela. */
    let home: PaginaBaixada;
    try {
      home = await lerPaginaHtml(new URL(normalizada.url), true);
    } catch (erro) {
      resultado.motivoGeral = motivoDe(erro, "home");
      return resultado;
    }
    const lidas: PaginaBaixada[] = [home];

    /** O host em que a home terminou (a variante com ou sem www vale) é o do resto da leitura: os links são reescritos para ele. */
    const homeUrl = new URL(home.url);
    hostPermitido = homeUrl.hostname;
    resultado.hostFinal = hostPermitido;
    let candidatos = classificarCandidatos(
      home.extracao.links,
      homeUrl,
      home.extracao.baseHref,
      hostPermitido,
    );
    if (candidatos.length === 0 && !parar && !sinalTotal.aborted) {
      try {
        candidatos = await candidatosDoSitemap(homeUrl);
      } catch (erro) {
        resultado.ignoradas.push({
          url: `https://${hostPermitido}/sitemap.xml`,
          motivo: motivoDe(erro, "sitemap"),
        });
      }
    }

    /* Candidatos que o robots.txt proíbe caem no próximo da mesma categoria e ficam registrados. */
    const regrasDaHome = regrasPorHost.get(hostPermitido.toLowerCase()) ?? robotsPermiteTudo();
    const escolhidos = selecionarPorOrcamento(candidatos, undefined, (candidato) => {
      const url = new URL(candidato.url);
      if (regrasDaHome.permite(`${url.pathname}${url.search}`)) return true;
      resultado.ignoradas.push({ url: candidato.url, motivo: "robots_proibe" });
      return false;
    }).slice(0, Math.max(limites.maxPaginas - 1, 0));

    for (const candidato of escolhidos) {
      if (parar || sinalTotal.aborted) {
        resultado.ignoradas.push({
          url: candidato.url,
          motivo: parar ? "bloqueado_pelo_site" : "tempo_esgotado",
        });
        continue;
      }
      try {
        lidas.push(await lerPaginaHtml(new URL(candidato.url), false));
      } catch (erro) {
        resultado.ignoradas.push({ url: candidato.url, motivo: motivoDe(erro, "pagina") });
      }
    }

    /* Texto: sem as linhas que a página anterior já trouxe, sem página vazia, com os tetos. */
    const textos = removerLinhasRepetidasEntrePaginas(lidas.map((pagina) => pagina.extracao.texto));
    const aproveitaveis = lidas.flatMap((pagina, i) => {
      if (!pagina.ehHome && textos[i].length < MINIMO_TEXTO_UTIL) {
        resultado.ignoradas.push({ url: pagina.url, motivo: "sem_texto" });
        return [];
      }
      return [{ pagina, texto: textos[i] }];
    });

    const insuficiente = textoInsuficiente(
      aproveitaveis.map(({ pagina, texto }) => ({ texto, ehHome: pagina.ehHome })),
    );
    const comTetos = aplicarTetosDeTexto(aproveitaveis.map(({ texto }) => texto));
    aproveitaveis.forEach(({ pagina }, i) => {
      const texto = comTetos[i];
      if (!pagina.ehHome && texto.length < MINIMO_TEXTO_UTIL) {
        resultado.ignoradas.push({ url: pagina.url, motivo: "grande_demais" });
        return;
      }
      resultado.paginas.push({
        url: pagina.url,
        status: pagina.status,
        bytes: pagina.bytes,
        truncada: pagina.truncada,
        titulo: pagina.extracao.titulo,
        descricao: pagina.extracao.descricao,
        texto,
        hash: hashDoTexto(texto),
      });
    });
    resultado.motivoGeral = insuficiente ? "sem_texto" : null;
    return resultado;
  } catch (erro) {
    /** Nada aqui deveria lançar; se lançou é defeito nosso: registra e devolve, para a fila não repetir a leitura. */
    logger.error({ err: erro, host: hostPermitido }, "site-api: falha inesperada na leitura");
    resultado.motivoGeral = resultado.paginas.length > 0 ? null : "sem_resposta";
    return resultado;
  } finally {
    if (agente) await agente.destroy().catch(() => undefined);
  }
}
