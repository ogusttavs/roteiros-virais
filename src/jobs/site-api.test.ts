import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { Agent, fetch as undiciFetch } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";

import { config } from "@/lib/config";
import { logger } from "@/lib/log";

import {
  criarAgenteSeguro,
  criarLookupSeguro,
  ErroLeituraSite,
  lerSiteDaMarca,
  LIMITES_PADRAO,
  montarUserAgent,
  type BuscarLeitor,
  type OpcoesLeitor,
  type PedidoLeitor,
  type RespostaLeitor,
  type ResolverDns,
  type ResultadoLeituraSite,
} from "./site-api";

function fixture(nome: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../tests/fixtures/site/${nome}`, import.meta.url)),
    "utf8",
  );
}

/* ------------------------------------------------------------------ */
/* Um site falso, sem soquete: o `buscar` injetado devolve `Response`   */
/* ------------------------------------------------------------------ */

type FabricaDeResposta = () => Response | Promise<Response>;
type Rotas = Record<string, FabricaDeResposta>;

const html = (corpo: BodyInit, cabecalhos: Record<string, string> = {}): Response =>
  new Response(corpo, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...cabecalhos },
  });
const texto = (corpo: string): Response =>
  new Response(corpo, { status: 200, headers: { "content-type": "text/plain" } });
const comStatus = (status: number, cabecalhos: Record<string, string> = {}): Response =>
  new Response("erro", { status, headers: { "content-type": "text/html", ...cabecalhos } });
const redireciona = (para: string, status = 302): Response =>
  new Response(null, { status, headers: { location: para } });

/** O site de exemplo: home com links, as páginas que o orçamento escolhe, e robots.txt ausente. */
function padaria(): Rotas {
  return {
    "loja-exemplo.test/robots.txt": () => comStatus(404),
    "loja-exemplo.test/": () => html(fixture("home-padaria.html")),
    "loja-exemplo.test/sobre-nos": () => html(fixture("pagina-sobre.html")),
    "loja-exemplo.test/produtos": () => html(fixture("pagina-produtos.html")),
    "loja-exemplo.test/produtos/bolos": () => html(fixture("pagina-servicos.html")),
    "loja-exemplo.test/produtos/paes-artesanais": () => html(fixture("pagina-servicos.html")),
    "loja-exemplo.test/servicos/encomendas": () => html(fixture("pagina-servicos.html")),
    "loja-exemplo.test/contato": () => html(fixture("pagina-contato.html")),
  };
}

type Chamada = { url: string; init: PedidoLeitor };

function montar(rotas: Rotas) {
  const chamadas: Chamada[] = [];
  const buscar = vi.fn<BuscarLeitor>(async (url, init) => {
    chamadas.push({ url, init });
    const alvo = new URL(url);
    const fabrica = rotas[`${alvo.hostname}${alvo.pathname}`];
    return fabrica ? fabrica() : comStatus(404);
  });
  const esperar = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
  return { buscar, esperar, chamadas, urls: () => chamadas.map((chamada) => chamada.url) };
}

async function ler(
  url: string,
  rotas: Rotas,
  opcoes: Omit<OpcoesLeitor, "buscar" | "esperar"> = {},
): Promise<{ resultado: ResultadoLeituraSite } & ReturnType<typeof montar>> {
  const site = montar(rotas);
  const resultado = await lerSiteDaMarca(url, {
    ...opcoes,
    buscar: site.buscar,
    esperar: site.esperar,
  });
  return { resultado, ...site };
}

/** Um corpo que dá uma parte e depois nunca mais responde (e nunca escuta o sinal). */
function corpoQueTrava(primeiraParte: string, aoCancelar: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controlador) {
      controlador.enqueue(new TextEncoder().encode(primeiraParte));
    },
    cancel: aoCancelar,
  });
}

/** Um corpo que nunca acaba: cada leitura devolve mais uma linha diferente. `pull` só roda quando alguém lê. */
function corpoInfinito(aoLer: () => void, aoCancelar: () => void): ReadableStream<Uint8Array> {
  const codificador = new TextEncoder();
  let linha = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controlador) {
        aoLer();
        const prefixo = linha === 0 ? "<html><body>" : "";
        linha += 1;
        controlador.enqueue(
          codificador.encode(
            `${prefixo}<p>Linha ${linha} da pagina que nunca termina, para provar o teto de bytes da leitura.</p>`,
          ),
        );
      },
      cancel: aoCancelar,
    },
    { highWaterMark: 0 },
  );
}

/** Um corpo que ninguém deveria ler: com `highWaterMark: 0`, `pull` só roda se houver uma leitura. */
function corpoQueNaoDeveSerLido(
  aoLer: () => void,
  aoCancelar: () => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    {
      pull(controlador) {
        aoLer();
        controlador.enqueue(new TextEncoder().encode("%PDF-1.7 conteudo binario"));
      },
      cancel: aoCancelar,
    },
    { highWaterMark: 0 },
  );
}

function ficarPendenteAteAbortar(init: PedidoLeitor): Promise<Response> {
  return new Promise<Response>((_, rejeitar) => {
    init.signal.addEventListener("abort", () => rejeitar(init.signal.reason), { once: true });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* O caminho feliz                                                     */
/* ------------------------------------------------------------------ */

describe("lerSiteDaMarca: a leitura normal", () => {
  it("le a home e as quatro paginas do orcamento (1 sobre, 2 produtos, 1 curinga), em ordem, com pausa entre as requisicoes", async () => {
    const { resultado, urls, esperar } = await ler("https://loja-exemplo.test", padaria());

    expect(resultado.motivoGeral).toBeNull();
    expect(resultado.urlInicial).toBe("https://loja-exemplo.test/");
    expect(resultado.hostFinal).toBe("loja-exemplo.test");
    expect(resultado.paginas.map((pagina) => pagina.url)).toEqual([
      "https://loja-exemplo.test/",
      "https://loja-exemplo.test/sobre-nos",
      "https://loja-exemplo.test/produtos",
      "https://loja-exemplo.test/produtos/bolos",
      "https://loja-exemplo.test/contato",
    ]);
    expect(urls()).toEqual([
      "https://loja-exemplo.test/robots.txt",
      "https://loja-exemplo.test/",
      "https://loja-exemplo.test/sobre-nos",
      "https://loja-exemplo.test/produtos",
      "https://loja-exemplo.test/produtos/bolos",
      "https://loja-exemplo.test/contato",
    ]);
    expect(resultado.requisicoes).toBe(6);
    expect(resultado.ignoradas).toEqual([]);

    /** Uma requisicao por vez, com a pausa de 500 ms entre uma e outra (nao antes da primeira). */
    expect(esperar).toHaveBeenCalledTimes(5);
    for (const chamada of esperar.mock.calls) expect(chamada[0]).toBe(LIMITES_PADRAO.pausaMs);
    expect(LIMITES_PADRAO.pausaMs).toBe(500);

    const home = resultado.paginas[0];
    expect(home.status).toBe(200);
    expect(home.titulo).toBe("Padaria Exemplo | Pão artesanal em Cidade Modelo");
    expect(home.descricao).toContain("Pães de fermentação natural");
    expect(home.truncada).toBe(false);
    expect(home.bytes).toBe(Buffer.byteLength(fixture("home-padaria.html")));
    for (const pagina of resultado.paginas) expect(pagina.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(resultado.paginas.map((pagina) => pagina.hash)).size).toBe(5);
    expect(resultado.bytesTotais).toBe(
      resultado.paginas.reduce((soma, pagina) => soma + pagina.bytes, 0),
    );
    expect(resultado.paginas[4].texto).toContain("Abrimos de terça a sábado");
  });

  it("nenhum e-mail, telefone, script, menu ou aviso de cookie chega ao texto final", async () => {
    const { resultado } = await ler("https://loja-exemplo.test/", padaria());
    const tudo = resultado.paginas.map((pagina) => pagina.texto).join("\n");
    expect(tudo).not.toMatch(/@/);
    expect(tudo).not.toMatch(/99999/);
    expect(tudo).not.toContain("dataLayer");
    expect(tudo).not.toContain("Usamos cookies");
    expect(tudo).not.toContain("Política de privacidade");
    expect(tudo).not.toMatch(/[<>]/);
  });

  it("manda um cabecalho honesto, sem cookie, sem Authorization, com redirecionamento manual e sinal em toda requisicao", async () => {
    const { chamadas } = await ler("https://loja-exemplo.test/", padaria());
    const identidade = montarUserAgent();
    expect(chamadas.length).toBeGreaterThan(3);
    for (const { init } of chamadas) {
      const nomes = Object.keys(init.headers).map((nome) => nome.toLowerCase());
      expect(nomes).not.toContain("cookie");
      expect(nomes).not.toContain("authorization");
      expect(nomes).not.toContain("proxy-authorization");
      expect(nomes).not.toContain("referer");
      expect(init.headers["User-Agent"]).toBe(identidade.cabecalho);
      expect(init.headers.Accept).toBe("text/html,application/xhtml+xml;q=0.9,*/*;q=0.1");
      expect(init.headers["Accept-Language"]).toBe("pt-BR,pt;q=0.9,en;q=0.5");
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("manual");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("o User-Agent vem de APP_NAME, APP_URL e EMAIL_CONTATO, higienizado, e nunca finge ser navegador", () => {
    const { token, cabecalho } = montarUserAgent();
    const nome = config.appName.replace(/[^A-Za-z0-9.+_-]/g, "");
    expect(token).toBe(`${nome}-Leitor`);
    expect(cabecalho.startsWith(`${token}/1.0 (+`)).toBe(true);
    expect(cabecalho).toContain(config.appUrl);
    expect(cabecalho).toContain(config.emailContato);
    expect(cabecalho).not.toMatch(/mozilla|chrome|safari|firefox|gecko/i);
    expect(cabecalho).toMatch(/^[\x20-\x7E]+$/);

    const original = config.appName;
    try {
      config.appName = "Meu App Legal! (beta)";
      expect(montarUserAgent().token).toBe("MeuAppLegalbeta-Leitor");
      config.appName = "!!!";
      expect(montarUserAgent().token).toBe("Leitor");
    } finally {
      config.appName = original;
    }
  });

  it("respeita o userAgent injetado, e o robots.txt enxerga o token dele", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/robots.txt"] = () =>
      texto("User-agent: MeuRobo-Leitor\nDisallow: /\n");
    const { resultado, chamadas } = await ler("https://loja-exemplo.test/", rotas, {
      userAgent: "MeuRobo-Leitor/2.0 (+https://exemplo.test)",
    });
    expect(resultado.motivoGeral).toBe("robots_proibe");
    expect(chamadas[0].init.headers["User-Agent"]).toBe(
      "MeuRobo-Leitor/2.0 (+https://exemplo.test)",
    );
  });

  it("texto por pagina em 6.000 caracteres e total em 20.000, com a home primeiro", async () => {
    const grande = (rotulo: string) =>
      `<html><body><p>${Array.from({ length: 700 }, (_, i) => `${rotulo} frase numero ${i} com palavras diferentes para nao repetir.`).join("</p><p>")}</p></body></html>`;
    const rotas: Rotas = {
      "loja-exemplo.test/robots.txt": () => comStatus(404),
      "loja-exemplo.test/": () =>
        html(
          `<html><body><a href="/sobre">Sobre</a><a href="/produtos">Produtos</a><a href="/servicos">Servicos</a><a href="/contato">Contato</a>${grande("Home").slice("<html><body>".length)}`,
        ),
      "loja-exemplo.test/sobre": () => html(grande("Sobre")),
      "loja-exemplo.test/produtos": () => html(grande("Produtos")),
      "loja-exemplo.test/servicos": () => html(grande("Servicos")),
      "loja-exemplo.test/contato": () => html(grande("Contato")),
    };
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    for (const pagina of resultado.paginas) expect(pagina.texto.length).toBeLessThanOrEqual(6_000);
    const total = resultado.paginas.reduce((soma, pagina) => soma + pagina.texto.length, 0);
    expect(total).toBeLessThanOrEqual(20_000);
    expect(resultado.paginas[0].texto.length).toBeGreaterThan(5_000);
    expect(resultado.paginas[0].url).toBe("https://loja-exemplo.test/");
    expect(resultado.paginas.length + resultado.ignoradas.length).toBe(5);
    expect(resultado.ignoradas.every((ignorada) => ignorada.motivo === "grande_demais")).toBe(true);
    expect(resultado.motivoGeral).toBeNull();
  });

  it("site com poucos links le menos paginas", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () =>
      html(
        `<html><head><title>Padaria Exemplo</title></head><body><p>${"Pão artesanal feito devagar todos os dias. ".repeat(10)}</p><a href="/contato">Contato</a></body></html>`,
      );
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.paginas.map((pagina) => pagina.url)).toEqual([
      "https://loja-exemplo.test/",
      "https://loja-exemplo.test/contato",
    ]);
    expect(urls()).toHaveLength(3);
  });

  it("nunca segue link para fora do site, para subdominio irmao nem para rede social", async () => {
    const rotas = padaria();
    const { urls } = await ler("https://loja-exemplo.test/", rotas);
    for (const url of urls()) expect(new URL(url).hostname).toBe("loja-exemplo.test");
  });
});

/* ------------------------------------------------------------------ */
/* Endereço                                                            */
/* ------------------------------------------------------------------ */

describe("lerSiteDaMarca: endereco recusado antes de qualquer conexao", () => {
  it.each([
    ["https://10.0.0.5/"],
    ["https://127.0.0.1/"],
    ["https://169.254.169.254/latest/meta-data/"],
    ["https://100.100.100.200/"],
    ["https://192.168.1.1/"],
    ["https://172.17.0.1/"],
    ["https://[::1]/"],
    ["https://[fe80::1]/"],
    ["https://[::ffff:127.0.0.1]/"],
    ["https://[::ffff:a9fe:a9fe]/"],
    ["https://2130706433/"],
    ["https://0x7f000001/"],
    ["https://0177.0.0.1/"],
    ["https://localhost/"],
    ["https://servico.localhost/"],
    ["https://metadata.google.internal/"],
  ])("IP privado ou nome interno %s: nao chama o buscar", async (endereco) => {
    const site = montar(padaria());
    const resolver = vi.fn();
    const resultado = await lerSiteDaMarca(endereco, {
      buscar: site.buscar,
      esperar: site.esperar,
      resolver,
    });
    expect(resultado.motivoGeral).toBe("endereco_privado");
    expect(resultado.paginas).toEqual([]);
    expect(resultado.requisicoes).toBe(0);
    expect(site.buscar).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each([
    ["http://loja-exemplo.test/"],
    ["loja-exemplo.test"],
    [""],
    ["https://usuario:senha@loja-exemplo.test/"],
    ["https://loja-exemplo.test:8443/"],
    ["https://intranet/"],
  ])("endereco invalido %j: nao chama o buscar", async (endereco) => {
    const { resultado, buscar } = await ler(endereco, padaria());
    expect(resultado.motivoGeral).toBe("endereco_invalido");
    expect(buscar).not.toHaveBeenCalled();
  });

  it.each([
    ["https://www.instagram.com/padariaexemplo"],
    ["https://linktr.ee/padariaexemplo"],
    ["https://wa.me/5511999990000"],
    ["https://www.youtube.com/@padariaexemplo"],
  ])("rede social ou pagina de links %s: motivo rede_social, sem ler", async (endereco) => {
    const { resultado, buscar } = await ler(endereco, padaria());
    expect(resultado.motivoGeral).toBe("rede_social");
    expect(buscar).not.toHaveBeenCalled();
    expect(resultado.urlInicial.startsWith("https://")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Redirecionamentos                                                   */
/* ------------------------------------------------------------------ */

describe("lerSiteDaMarca: redirecionamentos", () => {
  it("302 para IP privado (metadados de nuvem): recusa e o segundo buscar nao acontece", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => redireciona("https://169.254.169.254/latest/meta-data/");
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("endereco_privado");
    expect(resultado.paginas).toEqual([]);
    expect(urls()).toEqual(["https://loja-exemplo.test/robots.txt", "https://loja-exemplo.test/"]);
  });

  it.each([
    ["https://10.1.2.3/"],
    ["https://[::1]/"],
    ["https://127.0.0.1/admin"],
    ["https://localhost/"],
    ["https://painel.internal/"],
    ["https://2130706433/"],
  ])("302 para %s recusa como endereco_privado", async (destino) => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => redireciona(destino);
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("endereco_privado");
    expect(urls()).toHaveLength(2);
  });

  it("302 para http (rebaixamento) e recusado", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => redireciona("http://loja-exemplo.test/");
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("redirecionamento_invalido");
    expect(urls().some((url) => url.startsWith("http://"))).toBe(false);
  });

  it("redirecionamento sem Location, com Location invalido ou para porta estranha e recusado", async () => {
    for (const resposta of [
      () => new Response(null, { status: 301 }),
      () => redireciona("https://"),
      () => redireciona("https://loja-exemplo.test:8443/"),
      () => redireciona("https://usuario:senha@loja-exemplo.test/"),
      () => redireciona("ftp://loja-exemplo.test/"),
    ]) {
      const rotas = padaria();
      rotas["loja-exemplo.test/"] = resposta;
      const { resultado } = await ler("https://loja-exemplo.test/", rotas);
      expect(resultado.motivoGeral).toBe("redirecionamento_invalido");
    }
  });

  it("mais de 3 saltos e recusado; 3 saltos passam", async () => {
    const corrente = (saltos: number): Rotas => {
      const rotas = padaria();
      rotas["loja-exemplo.test/"] = () => redireciona("/a");
      rotas["loja-exemplo.test/a"] = () => redireciona("/b");
      rotas["loja-exemplo.test/b"] = () => redireciona("/c");
      rotas["loja-exemplo.test/c"] = () =>
        saltos >= 4 ? redireciona("/d") : html(fixture("home-padaria.html"));
      rotas["loja-exemplo.test/d"] = () => html(fixture("home-padaria.html"));
      return rotas;
    };

    const quatro = await ler("https://loja-exemplo.test/", corrente(4));
    expect(quatro.resultado.motivoGeral).toBe("redirecionamento_invalido");
    expect(quatro.urls()).not.toContain("https://loja-exemplo.test/d");

    const tres = await ler("https://loja-exemplo.test/", corrente(3));
    expect(tres.resultado.motivoGeral).toBeNull();
    expect(tres.resultado.paginas[0].url).toBe("https://loja-exemplo.test/c");
  });

  it("laco de redirecionamento termina no teto de saltos", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => redireciona("/");
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("redirecionamento_invalido");
    expect(urls().filter((url) => url === "https://loja-exemplo.test/")).toHaveLength(4);
  });

  it("primeira pagina: de loja-exemplo.test para www.loja-exemplo.test vale, e o resto da leitura segue no www", async () => {
    const rotas = padaria();
    const www = (caminho: string, resposta: FabricaDeResposta): [string, FabricaDeResposta] => [
      `www.loja-exemplo.test${caminho}`,
      resposta,
    ];
    const comWww: Rotas = {
      "loja-exemplo.test/robots.txt": () => comStatus(404),
      "loja-exemplo.test/": () => redireciona("https://www.loja-exemplo.test/", 301),
      ...Object.fromEntries(
        Object.entries(rotas)
          .filter(([chave]) => chave !== "loja-exemplo.test/robots.txt")
          .map(([chave, resposta]) => www(chave.replace("loja-exemplo.test", ""), resposta)),
      ),
      "www.loja-exemplo.test/robots.txt": () => comStatus(404),
    };
    const { resultado, urls } = await ler("https://loja-exemplo.test/", comWww);
    expect(resultado.motivoGeral).toBeNull();
    expect(resultado.hostFinal).toBe("www.loja-exemplo.test");
    expect(urls().slice(0, 4)).toEqual([
      "https://loja-exemplo.test/robots.txt",
      "https://loja-exemplo.test/",
      "https://www.loja-exemplo.test/robots.txt",
      "https://www.loja-exemplo.test/",
    ]);
    expect(
      urls()
        .slice(4)
        .every((url) => url.startsWith("https://www.loja-exemplo.test/")),
    ).toBe(true);
    expect(resultado.paginas).toHaveLength(5);
  });

  it("primeira pagina: pode redirecionar para outro host; o host final vira o permitido e o robots.txt dele e lido antes da pagina", async () => {
    const rotas: Rotas = {
      "loja-exemplo.test/robots.txt": () => comStatus(404),
      "loja-exemplo.test/": () => redireciona("https://novo-exemplo.test/inicio"),
      "novo-exemplo.test/robots.txt": () => comStatus(404),
      "novo-exemplo.test/inicio": () =>
        html(
          `<html><head><title>Novo endereco</title></head><body><p>${"Conteudo da pagina no endereco novo do site. ".repeat(12)}</p><a href="/sobre">Sobre</a><a href="https://loja-exemplo.test/contato">Contato antigo</a></body></html>`,
        ),
      "novo-exemplo.test/sobre": () => html(fixture("pagina-sobre.html")),
    };
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBeNull();
    expect(resultado.hostFinal).toBe("novo-exemplo.test");
    expect(urls()).toEqual([
      "https://loja-exemplo.test/robots.txt",
      "https://loja-exemplo.test/",
      "https://novo-exemplo.test/robots.txt",
      "https://novo-exemplo.test/inicio",
      "https://novo-exemplo.test/sobre",
    ]);
  });

  it("primeira pagina redirecionando para rede social: rede_social", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => redireciona("https://www.instagram.com/padariaexemplo");
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("rede_social");
    expect(urls().some((url) => url.includes("instagram"))).toBe(false);
  });

  it("segunda pagina: redirecionar para outro host e recusado, e o resto da leitura continua", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/sobre-nos"] = () => redireciona("https://outro-site.test/");
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBeNull();
    expect(resultado.ignoradas).toEqual([
      { url: "https://loja-exemplo.test/sobre-nos", motivo: "redirecionamento_invalido" },
    ]);
    expect(urls().some((url) => url.includes("outro-site.test"))).toBe(false);
    expect(resultado.paginas.map((pagina) => pagina.url)).toContain(
      "https://loja-exemplo.test/contato",
    );
    expect(resultado.paginas).toHaveLength(4);
  });

  it("segunda pagina: redirecionar para IP privado e recusado como endereco_privado", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/produtos"] = () => redireciona("https://192.168.0.1/");
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.ignoradas).toContainEqual({
      url: "https://loja-exemplo.test/produtos",
      motivo: "endereco_privado",
    });
    expect(urls().some((url) => url.includes("192.168"))).toBe(false);
  });

  it("segunda pagina: redirecionar dentro do mesmo site (com barra, com www) vale", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/sobre-nos"] = () =>
      redireciona("https://www.loja-exemplo.test/sobre-nos/");
    rotas["www.loja-exemplo.test/robots.txt"] = () => comStatus(404);
    rotas["www.loja-exemplo.test/sobre-nos/"] = () => html(fixture("pagina-sobre.html"));
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.paginas.map((pagina) => pagina.url)).toContain(
      "https://www.loja-exemplo.test/sobre-nos/",
    );
  });
});

/* ------------------------------------------------------------------ */
/* Guarda de IP: o lookup seguro                                       */
/* ------------------------------------------------------------------ */

describe("criarLookupSeguro", () => {
  type Resposta = Parameters<Parameters<ResolverDns>[2]>;

  function resolverCom(...resposta: Resposta): ResolverDns {
    return (_host, _opcoes, callback) => callback(...resposta);
  }

  function chamar(
    resolver: ResolverDns,
    opcoes: { all: boolean; family?: number | string; hints?: number } = { all: true },
  ) {
    const lookup = criarLookupSeguro(resolver);
    return new Promise<{ erro: Error | null; endereco: unknown; familia: number | undefined }>(
      (resolve) => {
        lookup("loja-exemplo.test", opcoes as never, (erro, endereco, familia) =>
          resolve({ erro, endereco, familia }),
        );
      },
    );
  }

  it("DNS que resolve para IP privado recusa com endereco_privado", async () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.7",
      "169.254.169.254",
      "192.168.1.5",
      "172.16.3.4",
      "100.64.0.9",
    ]) {
      const { erro } = await chamar(resolverCom(null, [{ address: ip, family: 4 }]));
      expect(erro, ip).toBeInstanceOf(ErroLeituraSite);
      expect((erro as ErroLeituraSite).motivo).toBe("endereco_privado");
    }
    const { erro } = await chamar(resolverCom(null, [{ address: "::1", family: 6 }]));
    expect((erro as ErroLeituraSite).motivo).toBe("endereco_privado");
    const mapeado = await chamar(resolverCom(null, [{ address: "::ffff:127.0.0.1", family: 6 }]));
    expect((mapeado.erro as ErroLeituraSite).motivo).toBe("endereco_privado");
  });

  it("resposta mista (um IP publico e um privado) tambem recusa, em vez de filtrar", async () => {
    const { erro } = await chamar(
      resolverCom(null, [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]),
    );
    expect(erro).toBeInstanceOf(ErroLeituraSite);
    const invertido = await chamar(
      resolverCom(null, [
        { address: "10.0.0.1", family: 4 },
        { address: "8.8.8.8", family: 4 },
      ]),
    );
    expect(invertido.erro).toBeInstanceOf(ErroLeituraSite);
  });

  it("resposta vazia recusa", async () => {
    const { erro } = await chamar(resolverCom(null, []));
    expect((erro as ErroLeituraSite).motivo).toBe("endereco_privado");
  });

  it("erro do DNS e repassado sem virar endereco_privado", async () => {
    const falha = Object.assign(new Error("nao achou"), { code: "ENOTFOUND" });
    const { erro } = await chamar(resolverCom(falha, []));
    expect(erro).toBe(falha);
  });

  it("todos publicos: devolve a lista inteira com all, ou so o primeiro sem all", async () => {
    const enderecos = [
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ];
    const comTodos = await chamar(resolverCom(null, enderecos), { all: true });
    expect(comTodos.erro).toBeNull();
    expect(comTodos.endereco).toEqual(enderecos);
    const comUm = await chamar(resolverCom(null, enderecos), { all: false });
    expect(comUm.erro).toBeNull();
    expect(comUm.endereco).toBe("8.8.8.8");
    expect(comUm.familia).toBe(4);
  });

  it("sempre pede all e verbatim ao resolvedor, repassando family e hints", async () => {
    const resolver = vi.fn<ResolverDns>((_host, _opcoes, callback) =>
      callback(null, [{ address: "8.8.8.8", family: 4 }]),
    );
    const lookup = criarLookupSeguro(resolver);
    await new Promise<void>((resolve) =>
      lookup("loja-exemplo.test", { all: false } as never, () => resolve()),
    );
    expect(resolver).toHaveBeenLastCalledWith(
      "loja-exemplo.test",
      { all: true, verbatim: true },
      expect.any(Function),
    );
    await new Promise<void>((resolve) =>
      lookup("loja-exemplo.test", { family: "IPv6", hints: 4, all: true } as never, () =>
        resolve(),
      ),
    );
    expect(resolver).toHaveBeenLastCalledWith(
      "loja-exemplo.test",
      { all: true, verbatim: true, family: 6, hints: 4 },
      expect.any(Function),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Corpo: teto de bytes, Content-Length, tipo                          */
/* ------------------------------------------------------------------ */

describe("lerSiteDaMarca: corpo", () => {
  it("resposta gigante em stream infinito: a leitura para no teto e o stream e cancelado", async () => {
    const leituras = vi.fn();
    const cancelamentos = vi.fn();
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => html(corpoInfinito(leituras, cancelamentos));
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);

    const home = resultado.paginas[0];
    expect(home.bytes).toBe(LIMITES_PADRAO.bytesPorPagina);
    expect(home.truncada).toBe(true);
    expect(cancelamentos).toHaveBeenCalledTimes(1);
    /** Cada leitura devolve ~90 bytes: 1 MiB sao uns 12 mil `pull`, nao um numero ilimitado. */
    expect(leituras.mock.calls.length).toBeLessThan(15_000);
    expect(resultado.motivoGeral).toBeNull();
    expect(home.texto.length).toBeLessThanOrEqual(6_000);
    expect(resultado.bytesTotais).toBeLessThanOrEqual(LIMITES_PADRAO.bytesTotais);
  });

  it("o teto por pagina e ajustavel pelos limites", async () => {
    const cancelamentos = vi.fn();
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => html(corpoInfinito(() => undefined, cancelamentos));
    const { resultado } = await ler("https://loja-exemplo.test/", rotas, {
      limites: { bytesPorPagina: 20_000 },
    });
    expect(resultado.paginas[0].bytes).toBe(20_000);
    expect(resultado.paginas[0].truncada).toBe(true);
    expect(cancelamentos).toHaveBeenCalledTimes(1);
  });

  it("corpo exatamente do tamanho do teto nao conta como truncado", async () => {
    const corpo = `<html><body><p>${"x".repeat(300)}</p></body></html>`;
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => html(corpo);
    const { resultado } = await ler("https://loja-exemplo.test/", rotas, {
      limites: { bytesPorPagina: corpo.length },
    });
    expect(resultado.paginas[0].truncada).toBe(false);
    expect(resultado.paginas[0].bytes).toBe(corpo.length);
  });

  it("Content-Length enorme e recusado antes de ler, e o corpo nunca e lido", async () => {
    const leituras = vi.fn();
    const cancelamentos = vi.fn();
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () =>
      html(corpoQueNaoDeveSerLido(leituras, cancelamentos), {
        "content-length": String(LIMITES_PADRAO.contentLengthMaximo + 1),
      });
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("grande_demais");
    expect(leituras).not.toHaveBeenCalled();
    expect(cancelamentos).toHaveBeenCalledTimes(1);
    expect(resultado.bytesTotais).toBe(0);
  });

  it("Content-Length no limite passa", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () =>
      html(fixture("home-padaria.html"), {
        "content-length": String(LIMITES_PADRAO.contentLengthMaximo),
      });
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBeNull();
  });

  it.each([
    ["application/pdf"],
    ["image/png"],
    ["application/json"],
    ["text/plain"],
    ["video/mp4"],
    ["application/octet-stream"],
  ])("Content-Type %s: recusa sem consumir o corpo", async (tipo) => {
    const leituras = vi.fn();
    const cancelamentos = vi.fn();
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () =>
      new Response(corpoQueNaoDeveSerLido(leituras, cancelamentos), {
        status: 200,
        headers: { "content-type": tipo },
      });
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("nao_e_html");
    expect(leituras).not.toHaveBeenCalled();
    expect(cancelamentos).toHaveBeenCalledTimes(1);
  });

  it("aceita application/xhtml+xml e Content-Type em maiusculas com charset", async () => {
    for (const tipo of [
      "application/xhtml+xml",
      "TEXT/HTML; Charset=UTF-8",
      "text/html;charset=utf-8",
    ]) {
      const rotas = padaria();
      rotas["loja-exemplo.test/"] = () =>
        new Response(fixture("home-padaria.html"), {
          status: 200,
          headers: { "content-type": tipo },
        });
      const { resultado } = await ler("https://loja-exemplo.test/", rotas);
      expect(resultado.motivoGeral, tipo).toBeNull();
    }
  });

  it("sem Content-Type: aceita se o corpo parece HTML, recusa se nao parece", async () => {
    const semTipo = (corpo: string) => () => {
      const resposta = new Response(corpo, { status: 200 });
      resposta.headers.delete("content-type");
      return resposta;
    };
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = semTipo(`\n  ${fixture("home-padaria.html")}`);
    expect((await ler("https://loja-exemplo.test/", rotas)).resultado.motivoGeral).toBeNull();

    rotas["loja-exemplo.test/"] = semTipo('{"nao":"e html"}');
    expect((await ler("https://loja-exemplo.test/", rotas)).resultado.motivoGeral).toBe(
      "nao_e_html",
    );
  });

  it("charset ISO-8859-1 no cabecalho: os acentos saem certos", async () => {
    const rotas = padaria();
    const bytes = Buffer.from(fixture("pagina-latin1.html"), "latin1");
    rotas["loja-exemplo.test/"] = () =>
      html(bytes, { "content-type": "text/html; charset=ISO-8859-1" });
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.paginas[0].titulo).toBe("Confeitaria São João");
    expect(resultado.paginas[0].texto).toContain("pão de ló, quindim");
    expect(resultado.paginas[0].texto).toContain("réveillon");
  });

  it("charset ISO-8859-1 so no meta (header sem charset) tambem funciona", async () => {
    const rotas = padaria();
    const bytes = Buffer.from(fixture("pagina-latin1.html"), "latin1");
    rotas["loja-exemplo.test/"] = () => html(bytes, { "content-type": "text/html" });
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.paginas[0].texto).toContain("ação de graças");
  });

  it("HTML truncado no meio de uma tag: aproveita o que veio, sem lancar", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => html(fixture("pagina-truncada.html"));
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBeNull();
    expect(resultado.paginas[0].texto).toContain("Corte clássico, barba na toalha quente");
  });

  it("pagina de aninhamento absurdo: aproveita o que veio antes e nao trava", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () =>
      html(
        `<html><body><p>${"Texto bom antes do aninhamento. ".repeat(15)}</p>${"<div>".repeat(200_000)}</body></html>`,
      );
    const inicio = Date.now();
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(Date.now() - inicio).toBeLessThan(3_000);
    expect(resultado.paginas[0].texto).toContain("Texto bom antes do aninhamento");
  });
});

/* ------------------------------------------------------------------ */
/* Tempo                                                               */
/* ------------------------------------------------------------------ */

describe("lerSiteDaMarca: tempo", () => {
  it("timeout por requisicao: a home que nunca responde vira tempo_esgotado", async () => {
    const rotas = padaria();
    const site = montar(rotas);
    const buscar: BuscarLeitor = vi.fn(async (url, init) => {
      if (new URL(url).pathname === "/") return ficarPendenteAteAbortar(init);
      return site.buscar(url, init);
    });
    const inicio = Date.now();
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar,
      esperar: site.esperar,
      limites: { tempoRequisicaoMs: 50 },
    });
    expect(resultado.motivoGeral).toBe("tempo_esgotado");
    expect(Date.now() - inicio).toBeLessThan(2_000);
  });

  it("buscar que ignora o sinal e nunca resolve tambem e derrubado pelo prazo", async () => {
    const site = montar(padaria());
    const buscar: BuscarLeitor = vi.fn(async (url, init) => {
      if (new URL(url).pathname === "/") return new Promise<Response>(() => undefined);
      return site.buscar(url, init);
    });
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar,
      esperar: site.esperar,
      limites: { tempoRequisicaoMs: 50 },
    });
    expect(resultado.motivoGeral).toBe("tempo_esgotado");
  });

  it("corpo que trava no meio: tempo_esgotado e o stream e cancelado", async () => {
    const cancelamentos = vi.fn();
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () =>
      html(corpoQueTrava("<html><body><p>comecou a vir e parou", cancelamentos));
    const { resultado } = await ler("https://loja-exemplo.test/", rotas, {
      limites: { tempoRequisicaoMs: 50 },
    });
    expect(resultado.motivoGeral).toBe("tempo_esgotado");
    expect(cancelamentos).toHaveBeenCalledTimes(1);
  });

  it("uma pagina lenta no meio da leitura vira ignorada e as outras seguem", async () => {
    const site = montar(padaria());
    const buscar: BuscarLeitor = vi.fn(async (url, init) => {
      if (new URL(url).pathname === "/sobre-nos") return ficarPendenteAteAbortar(init);
      return site.buscar(url, init);
    });
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar,
      esperar: site.esperar,
      limites: { tempoRequisicaoMs: 50 },
    });
    expect(resultado.motivoGeral).toBeNull();
    expect(resultado.ignoradas).toEqual([
      { url: "https://loja-exemplo.test/sobre-nos", motivo: "tempo_esgotado" },
    ]);
    expect(resultado.paginas).toHaveLength(4);
  });

  it("timeout total: ao estourar, as paginas que faltam nem sao pedidas", async () => {
    const site = montar(padaria());
    const buscar: BuscarLeitor = vi.fn(async (url, init) => {
      if (new URL(url).pathname === "/sobre-nos") return ficarPendenteAteAbortar(init);
      return site.buscar(url, init);
    });
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar,
      esperar: site.esperar,
      limites: { tempoTotalMs: 150, tempoRequisicaoMs: 10_000 },
    });
    expect(resultado.motivoGeral).toBeNull();
    expect(resultado.paginas.map((pagina) => pagina.url)).toEqual(["https://loja-exemplo.test/"]);
    expect(resultado.ignoradas).toHaveLength(4);
    expect(resultado.ignoradas.every((ignorada) => ignorada.motivo === "tempo_esgotado")).toBe(
      true,
    );
    const pedidas = vi.mocked(buscar).mock.calls.map((chamada) => chamada[0]);
    expect(pedidas).toEqual([
      "https://loja-exemplo.test/robots.txt",
      "https://loja-exemplo.test/",
      "https://loja-exemplo.test/sobre-nos",
    ]);
  });

  it("os prazos de verdade: 10 s por requisicao, 40 s no total, 5 s para conectar", () => {
    expect(LIMITES_PADRAO.tempoRequisicaoMs).toBe(10_000);
    expect(LIMITES_PADRAO.tempoTotalMs).toBe(40_000);
    expect(LIMITES_PADRAO.conexaoMs).toBe(5_000);
    expect(LIMITES_PADRAO.maxRequisicoes).toBe(10);
    expect(LIMITES_PADRAO.maxPaginas).toBe(5);
    expect(LIMITES_PADRAO.maxSaltos).toBe(3);
    expect(LIMITES_PADRAO.bytesPorPagina).toBe(1024 * 1024);
    expect(LIMITES_PADRAO.bytesTotais).toBe(4 * 1024 * 1024);
    expect(LIMITES_PADRAO.contentLengthMaximo).toBe(5 * 1024 * 1024);
  });
});

/* ------------------------------------------------------------------ */
/* robots.txt                                                          */
/* ------------------------------------------------------------------ */

describe("lerSiteDaMarca: robots.txt", () => {
  it("Disallow: / proibe a leitura, e a home nem e pedida", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/robots.txt"] = () => texto(fixture("robots-bloqueia-tudo.txt"));
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("robots_proibe");
    expect(resultado.paginas).toEqual([]);
    expect(urls()).toEqual(["https://loja-exemplo.test/robots.txt"]);
  });

  it("robots.txt 404 (e outros 4xx) significa sem regras: le normalmente", async () => {
    for (const status of [404, 410, 401, 403]) {
      const rotas = padaria();
      rotas["loja-exemplo.test/robots.txt"] = () => comStatus(status);
      const { resultado } = await ler("https://loja-exemplo.test/", rotas);
      expect(resultado.motivoGeral, String(status)).toBeNull();
      expect(resultado.paginas).toHaveLength(5);
    }
  });

  it("robots.txt com erro 5xx vale como proibido: robots_indisponivel, sem ler a home", async () => {
    for (const status of [500, 502, 503]) {
      const rotas = padaria();
      rotas["loja-exemplo.test/robots.txt"] = () => comStatus(status);
      const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
      expect(resultado.motivoGeral, String(status)).toBe("robots_indisponivel");
      expect(urls()).toEqual(["https://loja-exemplo.test/robots.txt"]);
    }
  });

  it("robots.txt que demora demais: robots_indisponivel", async () => {
    const site = montar(padaria());
    const buscar: BuscarLeitor = vi.fn(async (url, init) => {
      if (new URL(url).pathname === "/robots.txt") return ficarPendenteAteAbortar(init);
      return site.buscar(url, init);
    });
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar,
      esperar: site.esperar,
      limites: { tempoRequisicaoMs: 50 },
    });
    expect(resultado.motivoGeral).toBe("robots_indisponivel");
  });

  it("robots.txt com 429 e bloqueio", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/robots.txt"] = () => comStatus(429);
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("bloqueado_pelo_site");
    expect(urls()).toHaveLength(1);
  });

  it("robots.txt que redireciona dentro do site e lido normalmente", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/robots.txt"] = () =>
      redireciona("https://loja-exemplo.test/arquivos/robots.txt");
    rotas["loja-exemplo.test/arquivos/robots.txt"] = () => texto("User-agent: *\nDisallow: /\n");
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("robots_proibe");
  });

  it("robots.txt que redireciona para IP privado e recusado", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/robots.txt"] = () => redireciona("https://169.254.169.254/");
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("endereco_privado");
    expect(urls()).toEqual(["https://loja-exemplo.test/robots.txt"]);
  });

  it("proibicao parcial: a pagina proibida fica de fora, registrada, e a proxima da categoria ocupa a vaga", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/robots.txt"] = () =>
      texto("User-agent: *\nDisallow: /produtos/bolos\nDisallow: /sobre-nos\n");
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBeNull();
    expect(resultado.ignoradas).toEqual(
      expect.arrayContaining([
        { url: "https://loja-exemplo.test/sobre-nos", motivo: "robots_proibe" },
        { url: "https://loja-exemplo.test/produtos/bolos", motivo: "robots_proibe" },
      ]),
    );
    expect(urls()).not.toContain("https://loja-exemplo.test/sobre-nos");
    expect(urls()).not.toContain("https://loja-exemplo.test/produtos/bolos");
    expect(urls()).toContain("https://loja-exemplo.test/produtos");
    expect(urls()).toContain("https://loja-exemplo.test/servicos/encomendas");
  });

  it("Allow mais especifico reabre um caminho", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/robots.txt"] = () =>
      texto("User-agent: *\nDisallow: /produtos\nAllow: /produtos/bolos\n");
    const { urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(urls()).toContain("https://loja-exemplo.test/produtos/bolos");
    expect(urls()).not.toContain("https://loja-exemplo.test/produtos");
  });

  it("proibir so a home nao deixa ler a home, mesmo com o resto liberado", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/robots.txt"] = () => texto("User-agent: *\nDisallow: /$\n");
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("robots_proibe");
  });
});

/* ------------------------------------------------------------------ */
/* Status HTTP e bloqueios                                             */
/* ------------------------------------------------------------------ */

describe("lerSiteDaMarca: status e bloqueios", () => {
  it.each([[401], [403], [429]])(
    "home com %i: bloqueado_pelo_site, sem repetir com outro User-Agent",
    async (status) => {
      const rotas = padaria();
      rotas["loja-exemplo.test/"] = () => comStatus(status);
      const { resultado, urls, chamadas } = await ler("https://loja-exemplo.test/", rotas);
      expect(resultado.motivoGeral).toBe("bloqueado_pelo_site");
      expect(urls()).toEqual([
        "https://loja-exemplo.test/robots.txt",
        "https://loja-exemplo.test/",
      ]);
      expect(new Set(chamadas.map((chamada) => chamada.init.headers["User-Agent"])).size).toBe(1);
    },
  );

  it("403 numa pagina do meio para a rodada: as seguintes nem sao pedidas", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/produtos"] = () => comStatus(403);
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBeNull();
    expect(resultado.paginas.map((pagina) => pagina.url)).toEqual([
      "https://loja-exemplo.test/",
      "https://loja-exemplo.test/sobre-nos",
    ]);
    expect(resultado.ignoradas).toEqual([
      { url: "https://loja-exemplo.test/produtos", motivo: "bloqueado_pelo_site" },
      { url: "https://loja-exemplo.test/produtos/bolos", motivo: "bloqueado_pelo_site" },
      { url: "https://loja-exemplo.test/contato", motivo: "bloqueado_pelo_site" },
    ]);
    expect(urls()).not.toContain("https://loja-exemplo.test/contato");
  });

  it("pagina de desafio com status 200 vira bloqueado_pelo_site, nunca um resumo da tela do desafio", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => html(fixture("pagina-desafio.html"));
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("bloqueado_pelo_site");
    expect(resultado.paginas).toEqual([]);
    expect(urls()).toHaveLength(2);
  });

  it("desafio no meio da leitura: a pagina e as seguintes ficam de fora e a rodada para", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/produtos"] = () => html(fixture("pagina-desafio.html"));
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.paginas).toHaveLength(2);
    expect(resultado.ignoradas.map((ignorada) => ignorada.motivo)).toEqual([
      "bloqueado_pelo_site",
      "bloqueado_pelo_site",
      "bloqueado_pelo_site",
    ]);
    expect(urls()).not.toContain("https://loja-exemplo.test/contato");
  });

  it("cabecalho de desafio da protecao contra robos e bloqueio, mesmo com status 503", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => comStatus(503, { "cf-mitigated": "challenge" });
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("bloqueado_pelo_site");
  });

  it.each([[404], [410]])("home com %i: nao_encontrado", async (status) => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => comStatus(status);
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("nao_encontrado");
    expect(urls()).toHaveLength(2);
  });

  it.each([[500], [502], [503], [504], [520]])(
    "home com %i: erro_do_site, sem repeticao",
    async (status) => {
      const rotas = padaria();
      rotas["loja-exemplo.test/"] = () => comStatus(status);
      const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
      expect(resultado.motivoGeral).toBe("erro_do_site");
      expect(urls().filter((url) => url === "https://loja-exemplo.test/")).toHaveLength(1);
    },
  );

  it("pagina 404 no meio da leitura: ignorada, sem repetir, e a leitura segue", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/produtos"] = () => comStatus(404);
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBeNull();
    expect(resultado.ignoradas).toEqual([
      { url: "https://loja-exemplo.test/produtos", motivo: "nao_encontrado" },
    ]);
    expect(urls().filter((url) => url === "https://loja-exemplo.test/produtos")).toHaveLength(1);
    expect(resultado.paginas).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ */
/* Tetos de requisicoes e de bytes                                     */
/* ------------------------------------------------------------------ */

describe("lerSiteDaMarca: tetos", () => {
  it("teto de requisicoes: robots, saltos e paginas contam, e o que passa disso nao e pedido", async () => {
    const { resultado, buscar } = await ler("https://loja-exemplo.test/", padaria(), {
      limites: { maxRequisicoes: 3 },
    });
    expect(buscar).toHaveBeenCalledTimes(3);
    expect(resultado.requisicoes).toBe(3);
    expect(resultado.paginas).toHaveLength(2);
    expect(resultado.ignoradas).toHaveLength(3);
    expect(resultado.ignoradas.every((ignorada) => ignorada.motivo === "grande_demais")).toBe(true);
    expect(resultado.motivoGeral).toBeNull();
  });

  it("os saltos de redirecionamento contam no teto de requisicoes", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => redireciona("/a");
    rotas["loja-exemplo.test/a"] = () => redireciona("/b");
    rotas["loja-exemplo.test/b"] = () => html(fixture("home-padaria.html"));
    const { resultado, buscar } = await ler("https://loja-exemplo.test/", rotas, {
      limites: { maxRequisicoes: 3 },
    });
    expect(buscar).toHaveBeenCalledTimes(3);
    expect(resultado.motivoGeral).toBe("grande_demais");
  });

  it("teto padrao: no maximo 10 requisicoes mesmo com robots, saltos e paginas que redirecionam", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => redireciona("/inicio");
    rotas["loja-exemplo.test/inicio"] = () => html(fixture("home-padaria.html"));
    for (const caminho of ["/sobre-nos", "/produtos", "/produtos/bolos", "/contato"]) {
      const original = rotas[`loja-exemplo.test${caminho}`];
      rotas[`loja-exemplo.test${caminho}`] = () => redireciona(`${caminho}/final`);
      rotas[`loja-exemplo.test${caminho}/final`] = original;
    }
    const { resultado, buscar } = await ler("https://loja-exemplo.test/", rotas);
    expect(buscar).toHaveBeenCalledTimes(10);
    expect(resultado.requisicoes).toBe(10);
    expect(resultado.ignoradas).toEqual([
      { url: "https://loja-exemplo.test/contato", motivo: "grande_demais" },
    ]);
    expect(resultado.paginas).toHaveLength(4);
  });

  it("teto de bytes totais: a pagina que estoura e cortada e as seguintes nao entram", async () => {
    const tamanhoDaHome = Buffer.byteLength(fixture("home-padaria.html"));
    const { resultado } = await ler("https://loja-exemplo.test/", padaria(), {
      limites: { bytesTotais: tamanhoDaHome + 900 },
    });
    expect(resultado.bytesTotais).toBeLessThanOrEqual(tamanhoDaHome + 900);
    expect(resultado.paginas[0].truncada).toBe(false);
    expect(resultado.paginas[1].truncada).toBe(true);
    expect(resultado.ignoradas.length).toBeGreaterThanOrEqual(1);
    expect(resultado.ignoradas.every((ignorada) => ignorada.motivo === "grande_demais")).toBe(true);
  });

  it("os bytes do robots.txt e do sitemap entram na conta, e o teto do robots.txt e de 512 KiB", async () => {
    const rotas = padaria();
    const enorme = `User-agent: *\nDisallow: /privado\n${"# comentario\n".repeat(80_000)}Disallow: /sobre-nos\n`;
    rotas["loja-exemplo.test/robots.txt"] = () => texto(enorme);
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.bytesTotais).toBeGreaterThanOrEqual(512 * 1024);
    expect(resultado.bytesTotais).toBeLessThan(512 * 1024 + 200_000);
    /** A regra que veio depois do teto de 512 KiB nao vale. */
    expect(urls()).toContain("https://loja-exemplo.test/sobre-nos");
  });
});

/* ------------------------------------------------------------------ */
/* Sem texto e sitemap                                                 */
/* ------------------------------------------------------------------ */

describe("lerSiteDaMarca: texto e sitemap", () => {
  it("site de pagina unica que so carrega por JavaScript: sem_texto, com o pouco que houve", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => html(fixture("pagina-unica-vazia.html"));
    rotas["loja-exemplo.test/sitemap.xml"] = () => comStatus(404);
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.motivoGeral).toBe("sem_texto");
    expect(resultado.paginas).toHaveLength(1);
    expect(resultado.paginas[0].texto).not.toContain("este texto fica dentro de um script");
  });

  it("pagina com o texto so no noscript e lida como ultimo recurso", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = () => html(fixture("pagina-com-noscript.html"));
    rotas["loja-exemplo.test/sitemap.xml"] = () => comStatus(404);
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.paginas[0].texto).toContain("Consertamos bicicletas");
    expect(resultado.motivoGeral).toBeNull();
  });

  it("home com texto mas paginas vazias: as vazias ficam como sem_texto", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/sobre-nos"] = () =>
      html("<html><body><nav>so menu</nav><script>x</script></body></html>");
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.ignoradas).toContainEqual({
      url: "https://loja-exemplo.test/sobre-nos",
      motivo: "sem_texto",
    });
    expect(resultado.motivoGeral).toBeNull();
  });

  it("linhas que a home ja trouxe nao se repetem nas outras paginas", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/contato"] = () =>
      html(
        `<html><head><title>Padaria Exemplo | Pão artesanal em Cidade Modelo</title></head><body><p>Somos uma padaria de bairro em Cidade Modelo. Todo dia às seis da manhã o pão sai do forno, com fermentação natural de vinte e quatro horas e farinha de moinho local.</p><p>${"Linha nova so da pagina de contato com informacoes. ".repeat(3)}</p></body></html>`,
      );
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    const contato = resultado.paginas.find((pagina) => pagina.url.endsWith("/contato"));
    expect(contato?.texto).not.toContain("Somos uma padaria de bairro");
    expect(contato?.texto).toContain("Linha nova so da pagina de contato");
  });

  const homeSemLinks = () =>
    html(
      `<html><head><title>Padaria Exemplo</title></head><body><p>${"Padaria de bairro com pão artesanal, bolos e café coado na hora. ".repeat(8)}</p></body></html>`,
    );

  it("home sem links: usa o sitemap.xml para escolher as paginas", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = homeSemLinks;
    rotas["loja-exemplo.test/sitemap.xml"] = () =>
      new Response(fixture("sitemap.xml"), {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(urls()).toEqual([
      "https://loja-exemplo.test/robots.txt",
      "https://loja-exemplo.test/",
      "https://loja-exemplo.test/sitemap.xml",
      "https://loja-exemplo.test/sobre-nos",
      "https://loja-exemplo.test/produtos",
      "https://loja-exemplo.test/servicos/encomendas",
      expect.stringMatching(/^https:\/\/loja-exemplo\.test\/contato\?/),
    ]);
    expect(resultado.paginas.map((pagina) => pagina.url)).toEqual(
      expect.arrayContaining([
        "https://loja-exemplo.test/sobre-nos",
        "https://loja-exemplo.test/produtos",
      ]),
    );
    expect(resultado.motivoGeral).toBeNull();
  });

  it("home sem links: usa o Sitemap declarado no robots.txt (so do mesmo site) e le um filho do indice", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = homeSemLinks;
    rotas["loja-exemplo.test/robots.txt"] = () =>
      texto(
        "User-agent: *\nDisallow: /privado\nSitemap: https://outro-site.test/sitemap.xml\nSitemap: https://loja-exemplo.test/mapa-do-site.xml\n",
      );
    rotas["loja-exemplo.test/mapa-do-site.xml"] = () =>
      new Response(fixture("sitemap-indice.xml"), {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    rotas["loja-exemplo.test/page-sitemap.xml"] = () =>
      new Response(fixture("sitemap.xml"), {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    const { resultado, urls } = await ler("https://loja-exemplo.test/", rotas);
    expect(urls().slice(0, 4)).toEqual([
      "https://loja-exemplo.test/robots.txt",
      "https://loja-exemplo.test/",
      "https://loja-exemplo.test/mapa-do-site.xml",
      "https://loja-exemplo.test/page-sitemap.xml",
    ]);
    expect(urls().some((url) => url.includes("outro-site.test"))).toBe(false);
    expect(urls()).not.toContain("https://loja-exemplo.test/post-sitemap.xml");
    expect(resultado.paginas.length).toBeGreaterThan(1);
  });

  it("home sem links e sitemap com erro: le so a home e registra o sitemap como ignorado", async () => {
    const rotas = padaria();
    rotas["loja-exemplo.test/"] = homeSemLinks;
    rotas["loja-exemplo.test/sitemap.xml"] = () => comStatus(404);
    const { resultado } = await ler("https://loja-exemplo.test/", rotas);
    expect(resultado.paginas).toHaveLength(1);
    expect(resultado.ignoradas).toEqual([
      { url: "https://loja-exemplo.test/sitemap.xml", motivo: "nao_encontrado" },
    ]);
    expect(resultado.motivoGeral).toBeNull();
  });

  it("o sitemap nao e buscado quando a home ja tem links", async () => {
    const { urls } = await ler("https://loja-exemplo.test/", padaria());
    expect(urls().some((url) => url.includes("sitemap"))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Nunca lanca                                                         */
/* ------------------------------------------------------------------ */

describe("lerSiteDaMarca: nunca lanca por falha esperada", () => {
  it.each([
    ["ECONNREFUSED", "sem_resposta"],
    ["ENOTFOUND", "sem_resposta"],
    ["ECONNRESET", "sem_resposta"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "sem_resposta"],
    ["UND_ERR_CONNECT_TIMEOUT", "tempo_esgotado"],
    ["UND_ERR_HEADERS_TIMEOUT", "tempo_esgotado"],
  ])("falha de rede %s vira %s, sem log de erro", async (codigo, motivo) => {
    const registrar = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const falha = new TypeError("fetch failed", {
      cause: Object.assign(new Error("x"), { code: codigo }),
    });
    const buscar: BuscarLeitor = async () => {
      throw falha;
    };
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar,
      esperar: async () => undefined,
    });
    expect(resultado.motivoGeral).toBe(
      motivo === "tempo_esgotado" ? "robots_indisponivel" : "sem_resposta",
    );
    expect(registrar).not.toHaveBeenCalled();
  });

  it("um ErroLeituraSite no meio da cadeia de cause e reconhecido (o caso do lookup seguro dentro do fetch)", async () => {
    const buscar: BuscarLeitor = async () => {
      throw new TypeError("fetch failed", {
        cause: new ErroLeituraSite("endereco_privado", "resolve para IP privado"),
      });
    };
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar,
      esperar: async () => undefined,
    });
    expect(resultado.motivoGeral).toBe("endereco_privado");
  });

  it("erro inesperado vira sem_resposta, e o log tem o erro mas nunca o texto das paginas", async () => {
    const registrar = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const site = montar(padaria());
    const buscar: BuscarLeitor = async (url, init) => {
      if (new URL(url).pathname === "/produtos")
        throw new Error("defeito inesperado do nosso lado");
      return site.buscar(url, init);
    };
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar,
      esperar: site.esperar,
    });
    expect(resultado.ignoradas).toContainEqual({
      url: "https://loja-exemplo.test/produtos",
      motivo: "sem_resposta",
    });
    expect(resultado.paginas.length).toBeGreaterThan(1);
    expect(registrar).toHaveBeenCalled();
    const registrado = JSON.stringify(registrar.mock.calls, (_chave, valor: unknown) =>
      valor instanceof Error ? { message: valor.message, stack: valor.stack } : valor,
    );
    expect(registrado).not.toContain("Pão feito devagar");
    expect(registrado).not.toContain("Padaria Exemplo");
  });

  it("defeito nosso fora da rede (aqui, o `esperar` que lanca) nao lanca: devolve o motivo e registra", async () => {
    const registrar = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const site = montar(padaria());
    const esperar = async () => {
      throw new RangeError("algo que nao era para acontecer");
    };
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar: site.buscar,
      esperar,
    });
    expect(resultado.motivoGeral).toBe("sem_resposta");
    expect(registrar).toHaveBeenCalled();
  });

  it("devolve sempre o objeto completo, mesmo na falha mais cedo", async () => {
    const { resultado } = await ler("https://localhost/", padaria());
    expect(resultado).toEqual({
      urlInicial: "https://localhost/",
      hostFinal: null,
      paginas: [],
      ignoradas: [],
      bytesTotais: 0,
      requisicoes: 0,
      motivoGeral: "endereco_privado",
    });
  });
});

/* ------------------------------------------------------------------ */
/* O transporte de verdade, contra um servidor em 127.0.0.1             */
/* ------------------------------------------------------------------ */

describe("transporte real: a guarda de IP esta no caminho de conexao", () => {
  const servidores: Server[] = [];
  const agentes: Agent[] = [];

  async function abrirServidor(): Promise<{
    porta: number;
    conexoes: () => number;
    pedidos: () => number;
  }> {
    let conexoes = 0;
    let pedidos = 0;
    const servidor = createServer((_requisicao, resposta) => {
      pedidos += 1;
      resposta.writeHead(200, { "content-type": "text/html" });
      resposta.end("<html><body>servidor interno que nunca pode ser lido</body></html>");
    });
    servidor.on("connection", () => {
      conexoes += 1;
    });
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    servidores.push(servidor);
    return {
      porta: (servidor.address() as net.AddressInfo).port,
      conexoes: () => conexoes,
      pedidos: () => pedidos,
    };
  }

  afterEach(async () => {
    for (const agente of agentes.splice(0)) await agente.destroy().catch(() => undefined);
    for (const servidor of servidores.splice(0)) {
      servidor.closeAllConnections();
      await new Promise<void>((resolve) => servidor.close(() => resolve()));
    }
  });

  const paraLoopback: ResolverDns = (_host, _opcoes, callback) =>
    callback(null, [{ address: "127.0.0.1", family: 4 }]);

  function causaEmCadeia(erro: unknown): unknown[] {
    const cadeia: unknown[] = [];
    let atual: unknown = erro;
    for (let i = 0; i < 6 && atual; i += 1) {
      cadeia.push(atual);
      atual = (atual as { cause?: unknown }).cause;
    }
    return cadeia;
  }

  it("controle: sem a guarda, o mesmo nome que resolve para 127.0.0.1 CONECTA no servidor (prova que o teste enxerga conexoes)", async () => {
    const servidor = await abrirServidor();
    const semGuarda = new Agent({
      connect: {
        lookup: (_host, opcoes, callback) => {
          if (opcoes.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
          else callback(null, "127.0.0.1", 4);
        },
        timeout: 2_000,
      },
    });
    agentes.push(semGuarda);
    await expect(
      undiciFetch(`https://loja-exemplo.test:${servidor.porta}/`, {
        dispatcher: semGuarda,
        signal: AbortSignal.timeout(3_000),
      }),
    ).rejects.toThrow();
    /** O servidor e http e o cliente falou TLS: a conexao TCP existiu, so o aperto de mao falhou. */
    expect(servidor.conexoes()).toBeGreaterThanOrEqual(1);
  });

  it("com o agente seguro, um nome que resolve para 127.0.0.1 e recusado e o servidor recebe ZERO conexoes", async () => {
    const servidor = await abrirServidor();
    const resolver = vi.fn(paraLoopback);
    const agente = criarAgenteSeguro({ resolver, conexaoMs: 2_000 });
    agentes.push(agente);

    const falha = await undiciFetch(`https://loja-exemplo.test:${servidor.porta}/`, {
      dispatcher: agente,
      signal: AbortSignal.timeout(3_000),
    }).then(
      () => null,
      (erro: unknown) => erro,
    );
    expect(falha).not.toBeNull();
    const nosso = causaEmCadeia(falha).find((item) => item instanceof ErroLeituraSite) as
      ErroLeituraSite | undefined;
    expect(nosso?.motivo).toBe("endereco_privado");
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver.mock.calls[0][0]).toBe("loja-exemplo.test");
    expect(resolver.mock.calls[0][1]).toMatchObject({ all: true });
    expect(servidor.conexoes()).toBe(0);
    expect(servidor.pedidos()).toBe(0);
  });

  it("o leitor real (sem injetar buscar) recusa o nome que resolve para 127.0.0.1: endereco_privado, e nenhuma conexao no servidor", async () => {
    const servidor = await abrirServidor();
    const resolver = vi.fn(paraLoopback);
    const esperar = vi.fn(async () => undefined);
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", { resolver, esperar });
    expect(resultado.motivoGeral).toBe("endereco_privado");
    expect(resultado.paginas).toEqual([]);
    expect(resultado.requisicoes).toBe(1);
    expect(resolver).toHaveBeenCalled();
    expect(resolver.mock.calls.every((chamada) => chamada[0] === "loja-exemplo.test")).toBe(true);
    expect(servidor.conexoes()).toBe(0);
    expect(servidor.pedidos()).toBe(0);
  });

  it("o leitor real recusa resposta mista de DNS (um publico e um privado) sem conectar", async () => {
    const conectar = vi.spyOn(net.Socket.prototype, "connect");
    const resolver: ResolverDns = (_host, _opcoes, callback) =>
      callback(null, [
        { address: "8.8.8.8", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]);
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      resolver,
      esperar: async () => undefined,
    });
    expect(resultado.motivoGeral).toBe("endereco_privado");
    /** O `connect` do soquete ate foi chamado (e la dentro que o lookup roda), mas nenhum soquete abriu conexao: o servico de DNS falso e o unico que respondeu. */
    for (const chamada of conectar.mock.calls) {
      const alvo = chamada[0] as unknown as net.TcpNetConnectOpts;
      expect(alvo.host).not.toBe("8.8.8.8");
    }
  });

  it.each([
    ["https://127.0.0.1/"],
    ["https://10.0.0.5/"],
    ["https://169.254.169.254/latest/meta-data/"],
    ["https://100.100.100.200/"],
    ["https://[::1]/"],
    ["https://[::ffff:127.0.0.1]/"],
    ["https://[fd00::1]/"],
    ["https://2130706433/"],
  ])(
    "IP literal %s: o leitor real recusa antes de abrir qualquer soquete e antes de consultar o DNS",
    async (endereco) => {
      const conectar = vi.spyOn(net.Socket.prototype, "connect");
      const resolver = vi.fn(paraLoopback);
      const resultado = await lerSiteDaMarca(endereco, {
        resolver,
        esperar: async () => undefined,
      });
      expect(resultado.motivoGeral).toBe("endereco_privado");
      expect(resultado.requisicoes).toBe(0);
      expect(resolver).not.toHaveBeenCalled();
      expect(conectar).not.toHaveBeenCalled();
    },
  );

  it("redirecionamento manual do undici: o 302 chega com o Location legivel (a logica de saltos depende disso)", async () => {
    const servidor = createServer((requisicao, resposta) => {
      if (requisicao.url === "/de") {
        resposta.writeHead(302, { location: "https://169.254.169.254/latest/meta-data/" });
        resposta.end();
      } else {
        resposta.writeHead(200, { "content-type": "text/html" });
        resposta.end("ok");
      }
    });
    servidores.push(servidor);
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const porta = (servidor.address() as net.AddressInfo).port;
    const agente = new Agent();
    agentes.push(agente);

    const resposta = await undiciFetch(`http://127.0.0.1:${porta}/de`, {
      dispatcher: agente,
      redirect: "manual",
    });
    expect(resposta.status).toBe(302);
    expect(resposta.headers.get("location")).toBe("https://169.254.169.254/latest/meta-data/");
    await resposta.body?.cancel();
  });
});

/* ------------------------------------------------------------------ */
/* Ponta a ponta com o fetch do undici de verdade, num servidor local   */
/* ------------------------------------------------------------------ */

describe("transporte real: leitura de ponta a ponta contra um servidor em 127.0.0.1", () => {
  /**
   * Aqui a guarda de IP NAO entra (ela recusaria o 127.0.0.1, e e isso que os testes de cima
   * provam): o `buscar` injetado usa o fetch do undici de verdade, com um conector que manda toda
   * conexao "https" para o servidor local em HTTP puro. O que se prova e o resto do transporte
   * com soquete de verdade: redirecionamento manual, descompressao, corpo em pedacos, teto de bytes
   * com cancelamento, bomba de descompressao, prazo, e os cabecalhos que chegam ao servidor.
   */
  const servidores: Server[] = [];
  const agentes: Agent[] = [];
  const respostasPendentes: ServerResponse[] = [];

  async function abrirServidor(
    tratar: (requisicao: IncomingMessage, resposta: ServerResponse) => void,
  ): Promise<{ porta: number; requisicoes: IncomingMessage[] }> {
    const requisicoes: IncomingMessage[] = [];
    const servidor = createServer((requisicao, resposta) => {
      requisicoes.push(requisicao);
      tratar(requisicao, resposta);
    });
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    servidores.push(servidor);
    return { porta: (servidor.address() as net.AddressInfo).port, requisicoes };
  }

  function buscarNoServidor(porta: number): BuscarLeitor {
    const agente = new Agent({
      connect: (_opcoes, callback) => {
        const soquete = net.connect({ host: "127.0.0.1", port: porta });
        soquete.once("connect", () => callback(null, soquete));
        soquete.once("error", (falha) => callback(falha, null));
      },
    });
    agentes.push(agente);
    return (url, init) =>
      undiciFetch(url, { ...init, dispatcher: agente }) as unknown as Promise<RespostaLeitor>;
  }

  afterEach(async () => {
    for (const resposta of respostasPendentes.splice(0)) resposta.destroy();
    for (const agente of agentes.splice(0)) await agente.destroy().catch(() => undefined);
    for (const servidor of servidores.splice(0)) {
      servidor.closeAllConnections();
      await new Promise<void>((resolve) => servidor.close(() => resolve()));
    }
  });

  const esperarAte = async (condicao: () => boolean, ms = 3_000): Promise<boolean> => {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      if (condicao()) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return condicao();
  };

  const paragrafo = (rotulo: string) =>
    `<p>${rotulo}: ${"texto de exemplo para a pagina do servidor local de teste, com frases inteiras. ".repeat(6)}</p>`;

  it("le o site inteiro: gzip, redirecionamento, corpo em pedacos, e o servidor so recebe o que um leitor honesto manda", async () => {
    const home = `<html><head><title>Servidor local</title></head><body>${paragrafo("Home")}<a href="/sobre-nos">Quem somos</a><a href="/contato">Contato</a></body></html>`;
    const servidor = await abrirServidor((requisicao, resposta) => {
      const tipo = { "content-type": "text/html; charset=utf-8" };
      if (requisicao.url === "/robots.txt") {
        resposta.writeHead(404).end();
      } else if (requisicao.url === "/") {
        resposta.writeHead(200, { ...tipo, "content-encoding": "gzip" }).end(gzipSync(home));
      } else if (requisicao.url === "/sobre-nos") {
        resposta.writeHead(301, { location: "/sobre-nos-novo" }).end();
      } else if (requisicao.url === "/sobre-nos-novo") {
        const corpo = `<html><body>${paragrafo("Sobre")}</body></html>`;
        resposta.writeHead(200, tipo);
        resposta.write(corpo.slice(0, 40));
        setTimeout(() => resposta.end(corpo.slice(40)), 30);
      } else if (requisicao.url === "/contato") {
        resposta.writeHead(200, tipo).end(`<html><body>${paragrafo("Contato")}</body></html>`);
      } else {
        resposta.writeHead(404).end();
      }
    });

    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar: buscarNoServidor(servidor.porta),
      esperar: async () => undefined,
    });

    expect(resultado.motivoGeral).toBeNull();
    expect(resultado.paginas.map((pagina) => pagina.url)).toEqual([
      "https://loja-exemplo.test/",
      "https://loja-exemplo.test/sobre-nos-novo",
      "https://loja-exemplo.test/contato",
    ]);
    expect(resultado.paginas[0].titulo).toBe("Servidor local");
    expect(resultado.paginas[0].texto).toContain("Home: texto de exemplo");
    expect(resultado.paginas[0].bytes).toBe(Buffer.byteLength(home));
    expect(resultado.paginas[1].texto).toContain("Sobre: texto de exemplo");
    expect(servidor.requisicoes.map((requisicao) => requisicao.url)).toEqual([
      "/robots.txt",
      "/",
      "/sobre-nos",
      "/sobre-nos-novo",
      "/contato",
    ]);

    const identidade = montarUserAgent();
    for (const requisicao of servidor.requisicoes) {
      const cabecalhos = requisicao.headers;
      expect(cabecalhos["user-agent"]).toBe(identidade.cabecalho);
      expect(cabecalhos.accept).toBe("text/html,application/xhtml+xml;q=0.9,*/*;q=0.1");
      expect(cabecalhos["accept-language"]).toBe("pt-BR,pt;q=0.9,en;q=0.5");
      expect(cabecalhos.host).toBe("loja-exemplo.test");
      expect(cabecalhos.cookie).toBeUndefined();
      expect(cabecalhos.authorization).toBeUndefined();
      expect(cabecalhos["proxy-authorization"]).toBeUndefined();
      expect(cabecalhos.referer).toBeUndefined();
      expect(requisicao.method).toBe("GET");
    }
  });

  it("o servidor que nunca para de mandar corpo: a leitura para em 1 MiB, cancela, e o servidor ve a conexao fechar", async () => {
    let escritos = 0;
    let fechou = false;
    const servidor = await abrirServidor((requisicao, resposta) => {
      if (requisicao.url !== "/") {
        resposta.writeHead(404).end();
        return;
      }
      resposta.writeHead(200, { "content-type": "text/html" });
      resposta.write("<html><body>");
      resposta.on("close", () => {
        fechou = true;
      });
      let linha = 0;
      const escrever = () => {
        while (!resposta.destroyed) {
          linha += 1;
          const pedaco =
            `<p>Linha ${linha} do corpo que nunca termina, para provar o teto de bytes.</p>`.repeat(
              200,
            );
          escritos += pedaco.length;
          if (!resposta.write(pedaco)) {
            resposta.once("drain", escrever);
            return;
          }
        }
      };
      escrever();
    });

    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar: buscarNoServidor(servidor.porta),
      esperar: async () => undefined,
    });
    expect(resultado.paginas[0].bytes).toBe(LIMITES_PADRAO.bytesPorPagina);
    expect(resultado.paginas[0].truncada).toBe(true);
    expect(resultado.bytesTotais).toBe(LIMITES_PADRAO.bytesPorPagina);
    expect(await esperarAte(() => fechou)).toBe(true);
    expect(escritos).toBeLessThan(32 * 1024 * 1024);
  });

  it("bomba de descompressao: 64 MiB de gzip minusculo, a leitura para em 1 MiB ja descomprimido", async () => {
    const bomba = gzipSync(Buffer.alloc(64 * 1024 * 1024, "a"));
    expect(bomba.length).toBeLessThan(200_000);
    const servidor = await abrirServidor((requisicao, resposta) => {
      if (requisicao.url !== "/") {
        resposta.writeHead(404).end();
        return;
      }
      resposta
        .writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" })
        .end(bomba);
    });
    const inicio = Date.now();
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar: buscarNoServidor(servidor.porta),
      esperar: async () => undefined,
    });
    expect(resultado.bytesTotais).toBe(LIMITES_PADRAO.bytesPorPagina);
    expect(resultado.paginas[0].bytes).toBe(LIMITES_PADRAO.bytesPorPagina);
    expect(resultado.paginas[0].truncada).toBe(true);
    expect(Date.now() - inicio).toBeLessThan(10_000);
  });

  it("servidor que aceita a conexao e nunca responde: tempo_esgotado no prazo da requisicao", async () => {
    const servidor = await abrirServidor((requisicao, resposta) => {
      if (requisicao.url === "/robots.txt") {
        resposta.writeHead(404).end();
        return;
      }
      respostasPendentes.push(resposta);
    });
    const inicio = Date.now();
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar: buscarNoServidor(servidor.porta),
      esperar: async () => undefined,
      limites: { tempoRequisicaoMs: 200 },
    });
    expect(resultado.motivoGeral).toBe("tempo_esgotado");
    expect(Date.now() - inicio).toBeLessThan(3_000);
  });

  it("servidor que manda o cabecalho e depois trava no corpo: tempo_esgotado, e a conexao e fechada", async () => {
    let fechou = false;
    const servidor = await abrirServidor((requisicao, resposta) => {
      if (requisicao.url === "/robots.txt") {
        resposta.writeHead(404).end();
        return;
      }
      resposta.writeHead(200, { "content-type": "text/html" });
      resposta.write("<html><body><p>comecou e parou");
      resposta.on("close", () => {
        fechou = true;
      });
      respostasPendentes.push(resposta);
    });
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar: buscarNoServidor(servidor.porta),
      esperar: async () => undefined,
      limites: { tempoRequisicaoMs: 200 },
    });
    expect(resultado.motivoGeral).toBe("tempo_esgotado");
    expect(await esperarAte(() => fechou)).toBe(true);
  });

  it("redirecionamento do servidor para IP privado: recusado, e o servidor nunca recebe o segundo pedido", async () => {
    const servidor = await abrirServidor((requisicao, resposta) => {
      if (requisicao.url === "/") {
        resposta.writeHead(302, { location: "https://169.254.169.254/latest/meta-data/" }).end();
      } else {
        resposta.writeHead(404).end();
      }
    });
    const resultado = await lerSiteDaMarca("https://loja-exemplo.test/", {
      buscar: buscarNoServidor(servidor.porta),
      esperar: async () => undefined,
    });
    expect(resultado.motivoGeral).toBe("endereco_privado");
    expect(servidor.requisicoes.map((requisicao) => requisicao.url)).toEqual(["/robots.txt", "/"]);
  });
});
