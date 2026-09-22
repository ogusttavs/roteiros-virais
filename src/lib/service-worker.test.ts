/**
 * `public/sw.js` (V7, itens 6 a 10 do PROXIMO.md) rodando de verdade dentro de
 * um sandbox (`vm`) com `caches` e `fetch` de mentira. O que se prova aqui e o
 * que importa para o cliente: a lista fechada do que o aparelho guarda, o que
 * NUNCA e guardado, que o guardado e do escopo vigente (usuario mais marca), e
 * que sem escopo nada e guardado. A prova de ponta a ponta, com um navegador
 * sem rede, e o e2e `tests/e2e/sem-rede.spec.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

const ORIGEM = "https://app.exemplo.invalido";
const CODIGO = readFileSync(path.resolve(__dirname, "..", "..", "public", "sw.js"), "utf8");

const HTML = "text/html; charset=utf-8";

function href(chave: string | { url: string }): string {
  return new URL(typeof chave === "string" ? chave : chave.url, ORIGEM).href;
}

/** Um `CacheStorage` de mentira, com o suficiente do que o service worker usa. */
function criarCaches() {
  const mapa = new Map<string, Map<string, Response>>();
  const entradasDe = (nome: string) => {
    if (!mapa.has(nome)) mapa.set(nome, new Map());
    return mapa.get(nome)!;
  };
  const caches = {
    open: async (nome: string) => {
      const entradas = entradasDe(nome);
      return {
        put: async (chave: string | { url: string }, resposta: Response) => {
          entradas.set(href(chave), resposta);
        },
        match: async (chave: string | { url: string }) => entradas.get(href(chave))?.clone(),
        keys: async () => [...entradas.keys()].map((url) => ({ url })),
        delete: async (chave: string | { url: string }) => entradas.delete(href(chave)),
        addAll: async (lista: string[]) => {
          for (const u of lista) entradas.set(href(u), new Response(`estatico ${u}`));
        },
      };
    },
    match: async (chave: string | { url: string }, opcoes?: { cacheName?: string }) => {
      const nomes = opcoes?.cacheName ? [opcoes.cacheName] : [...mapa.keys()];
      for (const nome of nomes) {
        const r = mapa.get(nome)?.get(href(chave));
        if (r) return r.clone();
      }
      return undefined;
    },
    keys: async () => [...mapa.keys()],
    delete: async (nome: string) => mapa.delete(nome),
  };
  return { caches, mapa };
}

/** Uma resposta com a cara de uma resposta de rede de verdade (`type`, `url` e `redirected`). */
function respostaDeRede(
  corpo: string,
  {
    status = 200,
    tipo = HTML,
    caminho,
    redirecionada = false,
  }: { status?: number; tipo?: string; caminho: string; redirecionada?: boolean },
): Response {
  const r = new Response(corpo, { status, headers: { "content-type": tipo } });
  Object.defineProperty(r, "type", { value: "basic" });
  Object.defineProperty(r, "url", { value: ORIGEM + caminho });
  Object.defineProperty(r, "redirected", { value: redirecionada });
  return r;
}

type Ouvinte = (evento: Record<string, unknown>) => void;

function criarServiceWorker() {
  const { caches, mapa } = criarCaches();
  const ouvintes: Record<string, Ouvinte> = {};
  const fetchMock = vi.fn<(pedido: string | { url: string }) => Promise<Response>>();
  const self = {
    location: { origin: ORIGEM },
    addEventListener: (tipo: string, fn: Ouvinte) => {
      ouvintes[tipo] = fn;
    },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
  };
  const contexto = vm.createContext({
    self,
    caches,
    fetch: fetchMock,
    Response,
    Request,
    Headers,
    URL,
    Promise,
    console,
  });
  vm.runInContext(CODIGO, contexto);

  async function pedir(
    caminho: string,
    {
      mode = "navigate",
      method = "GET",
      headers = {},
    }: { mode?: string; method?: string; headers?: Record<string, string> } = {},
  ) {
    let respondida: Promise<Response> | undefined;
    const pendentes: Promise<unknown>[] = [];
    ouvintes.fetch({
      request: {
        method,
        url: caminho.startsWith("http") ? caminho : ORIGEM + caminho,
        mode,
        headers: new Headers(headers),
      },
      respondWith: (p: Promise<Response>) => {
        respondida = p;
      },
      waitUntil: (p: Promise<unknown>) => {
        pendentes.push(p);
      },
    });
    const resposta = respondida ? await respondida : undefined;
    await Promise.all(pendentes);
    return { interceptou: respondida !== undefined, resposta };
  }

  async function mensagem(dados: unknown) {
    const pendentes: Promise<unknown>[] = [];
    ouvintes.message({ data: dados, waitUntil: (p: Promise<unknown>) => pendentes.push(p) });
    await Promise.all(pendentes);
  }

  async function ciclo(tipo: "install" | "activate") {
    const pendentes: Promise<unknown>[] = [];
    ouvintes[tipo]({ waitUntil: (p: Promise<unknown>) => pendentes.push(p) });
    await Promise.all(pendentes);
  }

  const definirEscopo = (escopo: string) => {
    mapa.set("roteiros-escopo", new Map([[href("/__escopo"), new Response(escopo)]]));
  };
  const texto = (nome: string, chave: string) => mapa.get(nome)?.get(href(chave))?.text();
  const chavesGuardadas = (nome: string) => [...(mapa.get(nome)?.keys() ?? [])].map((u) => new URL(u).pathname).sort();
  const nomesDePaginas = () => [...mapa.keys()].filter((n) => n.startsWith("roteiros-paginas"));

  return { pedir, mensagem, ciclo, mapa, fetchMock, definirEscopo, texto, chavesGuardadas, nomesDePaginas, self };
}

let sw: ReturnType<typeof criarServiceWorker>;

beforeEach(() => {
  sw = criarServiceWorker();
});

/** A rede responde HTML 200 na rota pedida, como o servidor de verdade. */
function redeResponde(corpo = "pagina do servidor") {
  sw.fetchMock.mockImplementation(async (pedido) => {
    const caminho = new URL(typeof pedido === "string" ? pedido : pedido.url, ORIGEM).pathname;
    return respostaDeRede(`${corpo} ${caminho}`, { caminho });
  });
}

function redeCaiu() {
  sw.fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
}

describe("o que guarda (lista fechada) e onde", () => {
  it("/hoje com a rede no ar: devolve a resposta da rede e guarda no cache do escopo vigente", async () => {
    sw.definirEscopo("usuario-a:1");
    redeResponde();

    const { resposta } = await sw.pedir("/hoje");

    expect(await resposta!.text()).toBe("pagina do servidor /hoje");
    expect(await sw.texto("roteiros-paginas:usuario-a:1", "/hoje")).toBe("pagina do servidor /hoje");
  });

  it("sem escopo gravado pela pagina, nada e guardado (falha fechada), mas a resposta da rede chega", async () => {
    redeResponde();

    const { resposta } = await sw.pedir("/hoje");

    expect(await resposta!.text()).toBe("pagina do servidor /hoje");
    expect(sw.nomesDePaginas()).toEqual([]);
  });

  it("o roteiro e o modo gravacao dele entram no mesmo cache", async () => {
    sw.definirEscopo("usuario-a:1");
    redeResponde();

    await sw.pedir("/roteiros/5");
    await sw.pedir("/roteiros/5/gravar");

    expect(sw.chavesGuardadas("roteiros-paginas:usuario-a:1")).toEqual(["/roteiros/5", "/roteiros/5/gravar"]);
  });

  it("so o ULTIMO roteiro aberto fica: abrir o 6 apaga o 5 e o gravar do 5, e o Hoje continua", async () => {
    sw.definirEscopo("usuario-a:1");
    redeResponde();

    await sw.pedir("/hoje");
    await sw.pedir("/roteiros/5");
    await sw.pedir("/roteiros/5/gravar");
    await sw.pedir("/roteiros/6");

    expect(sw.chavesGuardadas("roteiros-paginas:usuario-a:1")).toEqual(["/hoje", "/roteiros/6"]);
  });

  it("nenhuma outra tela e guardada, nem o admin, mesmo com 200 e escopo", async () => {
    sw.definirEscopo("usuario-a:1");
    redeResponde();

    for (const caminho of [
      "/admin",
      "/admin/clientes",
      "/admin/clientes/1",
      "/referencias",
      "/historico",
      "/conta",
      "/briefing",
      "/entrar",
      "/roteiros/5/imprimir",
      "/roteiros/abc",
      "/roteiros/5/outra",
      "/hoje/tema-livre",
    ]) {
      await sw.pedir(caminho);
    }

    expect(sw.chavesGuardadas("roteiros-paginas:usuario-a:1")).toEqual([]);
  });
});

describe("o que NUNCA guarda", () => {
  beforeEach(() => {
    sw.definirEscopo("usuario-a:1");
  });

  it("resposta que nao e 200 (500, 404) nao e guardada, e chega ao usuario do jeito que veio", async () => {
    sw.fetchMock.mockResolvedValue(respostaDeRede("erro", { status: 500, caminho: "/hoje" }));

    const { resposta } = await sw.pedir("/hoje");

    expect(resposta!.status).toBe(500);
    expect(sw.chavesGuardadas("roteiros-paginas:usuario-a:1")).toEqual([]);
  });

  it("resposta redirecionada (sessao vencida cai em /entrar) nao vira o /hoje guardado", async () => {
    sw.fetchMock.mockResolvedValue(respostaDeRede("tela de entrar", { caminho: "/entrar", redirecionada: true }));

    await sw.pedir("/hoje");

    expect(sw.chavesGuardadas("roteiros-paginas:usuario-a:1")).toEqual([]);
  });

  it("resposta redirecionada de volta para a propria rota pedida tambem nao e guardada (so o 200 direto vale)", async () => {
    sw.fetchMock.mockResolvedValue(respostaDeRede("pagina", { caminho: "/hoje", redirecionada: true }));

    await sw.pedir("/hoje");

    expect(sw.chavesGuardadas("roteiros-paginas:usuario-a:1")).toEqual([]);
  });

  it("resposta de outra rota que nao a pedida (mesmo 200, mesmo sem marca de redirecionamento) nao e guardada", async () => {
    sw.fetchMock.mockResolvedValue(respostaDeRede("tela de entrar", { caminho: "/entrar" }));

    await sw.pedir("/hoje");

    expect(sw.chavesGuardadas("roteiros-paginas:usuario-a:1")).toEqual([]);
  });

  it("resposta que nao e HTML nao e guardada como pagina", async () => {
    sw.fetchMock.mockResolvedValue(respostaDeRede("{}", { tipo: "application/json", caminho: "/hoje" }));

    await sw.pedir("/hoje");

    expect(sw.chavesGuardadas("roteiros-paginas:usuario-a:1")).toEqual([]);
  });

  it("pedido que nao e GET nem e tocado", async () => {
    redeResponde();

    const { interceptou } = await sw.pedir("/hoje", { method: "POST" });

    expect(interceptou).toBe(false);
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });

  it("/api nunca passa pelo service worker", async () => {
    redeResponde();

    expect((await sw.pedir("/api/roteiros/5/pdf")).interceptou).toBe(false);
    expect((await sw.pedir("/api/saude", { mode: "cors" })).interceptou).toBe(false);
  });

  it("pedido do App Router (cabecalho RSC, prefetch, ?_rsc=) nao e tocado, e a rede que cai nao vira dado guardado", async () => {
    redeResponde();

    expect((await sw.pedir("/hoje", { mode: "cors", headers: { rsc: "1" } })).interceptou).toBe(false);
    expect(
      (await sw.pedir("/roteiros/5", { mode: "cors", headers: { "next-router-prefetch": "1" } })).interceptou,
    ).toBe(false);
    expect((await sw.pedir("/hoje?_rsc=abc", { mode: "cors" })).interceptou).toBe(false);
    expect((await sw.pedir("/hoje?_rsc=abc")).interceptou).toBe(false);
    expect(sw.chavesGuardadas("roteiros-paginas:usuario-a:1")).toEqual([]);
  });

  it("outra origem nao e tocada", async () => {
    redeResponde();

    expect((await sw.pedir("https://outro.exemplo.invalido/hoje")).interceptou).toBe(false);
    expect((await sw.pedir("https://outro.exemplo.invalido/_next/static/a.js", { mode: "no-cors" })).interceptou).toBe(
      false,
    );
  });
});

describe("sem rede", () => {
  beforeEach(() => {
    sw.definirEscopo("usuario-a:1");
  });

  it("volta do guardado uma pagina da lista: o Hoje, o roteiro e o modo gravacao dele", async () => {
    redeResponde();
    await sw.pedir("/hoje");
    await sw.pedir("/roteiros/5");
    await sw.pedir("/roteiros/5/gravar");
    redeCaiu();

    expect(await (await sw.pedir("/hoje")).resposta!.text()).toBe("pagina do servidor /hoje");
    expect(await (await sw.pedir("/roteiros/5")).resposta!.text()).toBe("pagina do servidor /roteiros/5");
    expect(await (await sw.pedir("/roteiros/5/gravar")).resposta!.text()).toBe("pagina do servidor /roteiros/5/gravar");
  });

  it("a pagina servida do guardado leva a marca 'guardado' em Server-Timing, e a da rede nao", async () => {
    sw.definirEscopo("usuario-a:1");
    redeResponde();
    const daRede = (await sw.pedir("/roteiros/5")).resposta!;
    expect(daRede.headers.get("server-timing")).toBeNull();

    redeCaiu();
    const guardada = (await sw.pedir("/roteiros/5")).resposta!;
    expect(guardada.headers.get("server-timing")).toBe("guardado");
    expect(guardada.headers.get("content-type")).toContain("text/html");
    expect(await guardada.text()).toBe("pagina do servidor /roteiros/5");
  });

  it("uma pagina fora da lista mostra 'Sem conexao', nunca dado guardado de outra tela (admin, referencias)", async () => {
    await sw.ciclo("install");
    redeResponde();
    await sw.pedir("/hoje");
    redeCaiu();

    for (const caminho of ["/admin", "/admin/clientes", "/referencias", "/historico", "/roteiros/999"]) {
      const { resposta } = await sw.pedir(caminho);
      expect(await resposta!.text(), caminho).toBe("estatico /offline.html");
    }
  });

  it("um roteiro que nao foi o ultimo aberto (o 5, depois de abrir o 6) tambem mostra 'Sem conexao'", async () => {
    await sw.ciclo("install");
    redeResponde();
    await sw.pedir("/roteiros/5");
    await sw.pedir("/roteiros/6");
    redeCaiu();

    expect(await (await sw.pedir("/roteiros/5")).resposta!.text()).toBe("estatico /offline.html");
    expect(await (await sw.pedir("/roteiros/6")).resposta!.text()).toBe("pagina do servidor /roteiros/6");
  });

  it("outro usuario ou outra marca no escopo nunca le o que era do anterior", async () => {
    redeResponde();
    await sw.pedir("/roteiros/5");
    await sw.ciclo("install");
    redeCaiu();

    sw.definirEscopo("usuario-b:1");
    expect(await (await sw.pedir("/roteiros/5")).resposta!.text()).toBe("estatico /offline.html");

    sw.definirEscopo("usuario-a:2");
    expect(await (await sw.pedir("/roteiros/5")).resposta!.text()).toBe("estatico /offline.html");

    sw.definirEscopo("usuario-a:1");
    expect(await (await sw.pedir("/roteiros/5")).resposta!.text()).toBe("pagina do servidor /roteiros/5");
  });

  it("depois de sair (escopo e paginas apagados pela pagina), nada guardado volta", async () => {
    await sw.ciclo("install");
    redeResponde();
    await sw.pedir("/roteiros/5");
    sw.mapa.delete("roteiros-paginas:usuario-a:1");
    sw.mapa.delete("roteiros-escopo");
    redeCaiu();

    expect(await (await sw.pedir("/roteiros/5")).resposta!.text()).toBe("estatico /offline.html");
  });
});

describe("estaticos", () => {
  it("guarda o que a pagina pediu (rede primeiro) e devolve do guardado quando a rede cai", async () => {
    sw.fetchMock.mockResolvedValue(
      respostaDeRede("codigo", { tipo: "text/javascript", caminho: "/_next/static/chunks/a.js" }),
    );

    await sw.pedir("/_next/static/chunks/a.js", { mode: "no-cors" });
    redeCaiu();
    const { resposta } = await sw.pedir("/_next/static/chunks/a.js", { mode: "no-cors" });

    expect(await resposta!.text()).toBe("codigo");
  });

  it("so a lista fechada: /_next/image, /_next/data e qualquer outro arquivo nao passam pelo service worker", async () => {
    redeResponde();

    expect((await sw.pedir("/_next/image?url=x", { mode: "no-cors" })).interceptou).toBe(false);
    expect((await sw.pedir("/_next/data/x.json", { mode: "cors" })).interceptou).toBe(false);
    expect((await sw.pedir("/qualquer.js", { mode: "no-cors" })).interceptou).toBe(false);
    expect((await sw.pedir("/marca/klaki-logotipo.svg", { mode: "no-cors" })).interceptou).toBe(true);
    expect((await sw.pedir("/icone-192.png", { mode: "no-cors" })).interceptou).toBe(true);
  });
});

describe("teto do cache dos estaticos", () => {
  const limite = Number(/var LIMITE_ESTATICOS = (\d+);/.exec(CODIGO)?.[1]);

  it("passado do teto, apaga os mais antigos e nunca os fixos (pagina 'Sem conexao' e icones)", async () => {
    await sw.ciclo("install");
    const cache = sw.mapa.get("roteiros-estaticos-v1")!;
    for (let i = 0; i < limite + 5; i++) cache.set(href(`/_next/static/chunks/velho-${i}.js`), new Response("x"));
    sw.fetchMock.mockResolvedValue(
      respostaDeRede("novo", { tipo: "text/javascript", caminho: "/_next/static/chunks/novo.js" }),
    );

    await sw.pedir("/_next/static/chunks/novo.js", { mode: "no-cors" });

    const chaves = sw.chavesGuardadas("roteiros-estaticos-v1");
    const fixos = ["/favicon.svg", "/icone-192.png", "/offline.html"];
    expect(chaves.length).toBe(limite + fixos.length);
    for (const fixo of fixos) expect(chaves).toContain(fixo);
    expect(chaves).toContain("/_next/static/chunks/novo.js");
    // Passou seis do teto (cinco a mais, mais o novo): os seis primeiros que entraram foram os apagados.
    for (let i = 0; i < 6; i++) expect(chaves).not.toContain(`/_next/static/chunks/velho-${i}.js`);
    expect(chaves).toContain("/_next/static/chunks/velho-6.js");
  });

  it("abaixo do teto nao apaga nada", async () => {
    await sw.ciclo("install");
    sw.fetchMock.mockResolvedValue(
      respostaDeRede("x", { tipo: "text/javascript", caminho: "/_next/static/chunks/a.js" }),
    );

    await sw.pedir("/_next/static/chunks/a.js", { mode: "no-cors" });
    await sw.pedir("/_next/static/chunks/a.js", { mode: "no-cors" });

    expect(sw.chavesGuardadas("roteiros-estaticos-v1")).toEqual([
      "/_next/static/chunks/a.js",
      "/favicon.svg",
      "/icone-192.png",
      "/offline.html",
    ]);
  });
});

describe("instalar e ativar", () => {
  it("instalar guarda so a pagina 'Sem conexao' e os icones dela, nenhuma rota do app", async () => {
    await sw.ciclo("install");

    expect(sw.chavesGuardadas("roteiros-estaticos-v1")).toEqual(["/favicon.svg", "/icone-192.png", "/offline.html"]);
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  it("ativar apaga estaticos de versao antiga e nunca mexe nas paginas guardadas nem no escopo", async () => {
    sw.mapa.set("roteiros-estaticos-v0", new Map());
    sw.mapa.set("roteiros-estaticos-v1", new Map());
    sw.mapa.set("roteiros-paginas:usuario-a:1", new Map());
    sw.definirEscopo("usuario-a:1");

    await sw.ciclo("activate");

    expect([...sw.mapa.keys()].sort()).toEqual([
      "roteiros-escopo",
      "roteiros-estaticos-v1",
      "roteiros-paginas:usuario-a:1",
    ]);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });
});

describe("mensagens da pagina", () => {
  beforeEach(() => {
    sw.definirEscopo("usuario-a:1");
    redeResponde();
  });

  it("guardar o roteiro guarda tambem o modo gravacao dele, mesmo que o cliente nunca o tenha aberto", async () => {
    await sw.mensagem({ tipo: "guardar-pagina", caminho: "/roteiros/7" });

    expect(sw.chavesGuardadas("roteiros-paginas:usuario-a:1")).toEqual(["/roteiros/7", "/roteiros/7/gravar"]);
  });

  it("uma mensagem com caminho fora da lista (ou de outra origem) e ignorada sem nem buscar", async () => {
    await sw.mensagem({ tipo: "guardar-pagina", caminho: "/admin/clientes" });
    await sw.mensagem({ tipo: "guardar-pagina", caminho: "https://outro.exemplo.invalido/hoje" });
    await sw.mensagem({ tipo: "guardar-pagina", caminho: "/referencias" });

    expect(sw.fetchMock).not.toHaveBeenCalled();
    expect(sw.chavesGuardadas("roteiros-paginas:usuario-a:1")).toEqual([]);
  });

  it("sem escopo, a mensagem de guardar nao guarda nada", async () => {
    sw.mapa.delete("roteiros-escopo");

    await sw.mensagem({ tipo: "guardar-pagina", caminho: "/hoje" });

    expect(sw.nomesDePaginas()).toEqual([]);
  });

  it("guardar estaticos busca so os da lista fechada e pula os que ja estao guardados", async () => {
    sw.fetchMock.mockImplementation(async (pedido) => {
      const caminho = new URL(typeof pedido === "string" ? pedido : pedido.url, ORIGEM).pathname;
      return respostaDeRede("x", { tipo: "text/javascript", caminho });
    });
    await sw.mensagem({ tipo: "guardar-estaticos", caminhos: ["/_next/static/chunks/a.js"] });
    sw.fetchMock.mockClear();

    await sw.mensagem({
      tipo: "guardar-estaticos",
      caminhos: [
        "/_next/static/chunks/a.js",
        "/_next/static/chunks/b.js",
        "/admin/clientes",
        "/api/saude",
        "https://outro.exemplo.invalido/_next/static/c.js",
      ],
    });

    expect(sw.fetchMock).toHaveBeenCalledTimes(1);
    expect(sw.chavesGuardadas("roteiros-estaticos-v1")).toEqual([
      "/_next/static/chunks/a.js",
      "/_next/static/chunks/b.js",
    ]);
  });
});
