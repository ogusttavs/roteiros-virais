/**
 * `public/sw.js`, o evento `pushsubscriptionchange` (a inscrição de push que morria em silêncio): roda o arquivo de verdade num sandbox com um `self` falso e
 * confere o que ele pede ao servidor e ao navegador quando o navegador troca a inscrição sozinho.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

const CHAVE = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const CODIGO = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");

type Chamada = { url: string; init?: { method?: string; body?: string } };

function carregar(opcoes: { chaveDoServidor?: string | null; subscribe?: () => Promise<unknown>; userAgent?: string }) {
  const ouvintes: Record<string, (evento: unknown) => void> = {};
  const chamadas: Chamada[] = [];
  const subscribe = vi.fn(opcoes.subscribe ?? (async (..._args: unknown[]) => ({ toJSON: () => ({ endpoint: "https://web.push.apple.com/novo", keys: { p256dh: "a", auth: "b" } }) })));
  const self = {
    location: { origin: "https://app.exemplo.teste" },
    navigator: { userAgent: opcoes.userAgent ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
    registration: { pushManager: { subscribe } },
    addEventListener: (nome: string, fn: (evento: unknown) => void) => {
      ouvintes[nome] = fn;
    },
  };
  const fetchFalso = async (url: string, init?: Chamada["init"]) => {
    chamadas.push({ url, init });
    if (url === "/api/push/chave") {
      return opcoes.chaveDoServidor === null
        ? { ok: false, json: async () => ({}) }
        : { ok: true, json: async () => ({ chave: opcoes.chaveDoServidor ?? CHAVE }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  vm.runInNewContext(CODIGO, { self, fetch: fetchFalso, URL, Headers, Response, Uint8Array, atob, caches: {}, console });
  return { ouvintes, chamadas, subscribe };
}

async function disparar(ouvintes: Record<string, (evento: unknown) => void>, evento: Record<string, unknown>) {
  let espera: Promise<unknown> = Promise.resolve();
  ouvintes["pushsubscriptionchange"]({ ...evento, waitUntil: (p: Promise<unknown>) => (espera = p) });
  await espera;
}

describe("sw.js: pushsubscriptionchange", () => {
  it("o service worker escuta o evento", () => {
    expect(carregar({}).ouvintes["pushsubscriptionchange"]).toBeTypeOf("function");
  });

  it("sem inscrição nova do navegador: pede a chave de hoje, se inscreve com ela e manda a inscrição ao servidor, com o endereço antigo e o sistema", async () => {
    const { ouvintes, chamadas, subscribe } = carregar({});
    await disparar(ouvintes, { oldSubscription: { endpoint: "https://web.push.apple.com/velho" }, newSubscription: null });

    expect(subscribe).toHaveBeenCalledTimes(1);
    const pedido = subscribe.mock.calls[0][0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(pedido.userVisibleOnly).toBe(true);
    expect(pedido.applicationServerKey.length).toBe(65);
    expect(pedido.applicationServerKey[0]).toBe(4);

    const envio = chamadas.find((c) => c.url === "/api/push/inscricao")!;
    expect(envio.init?.method).toBe("POST");
    expect(JSON.parse(envio.init!.body!)).toEqual({
      endpoint: "https://web.push.apple.com/novo",
      p256dh: "a",
      auth: "b",
      sistema: "iphone",
      endpointAntigo: "https://web.push.apple.com/velho",
    });
  });

  it("a inscrição nova que o navegador já trouxe, com a chave de hoje, é aproveitada (não se inscreve de novo)", async () => {
    const { ouvintes, chamadas, subscribe } = carregar({});
    const bytes = Buffer.from(CHAVE.replace(/-/g, "+").replace(/_/g, "/") + "=", "base64");
    await disparar(ouvintes, {
      oldSubscription: null,
      newSubscription: {
        options: { applicationServerKey: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
        toJSON: () => ({ endpoint: "https://web.push.apple.com/da-troca", keys: { p256dh: "c", auth: "d" } }),
      },
    });
    expect(subscribe).not.toHaveBeenCalled();
    expect(JSON.parse(chamadas.find((c) => c.url === "/api/push/inscricao")!.init!.body!)).toMatchObject({ endpoint: "https://web.push.apple.com/da-troca", endpointAntigo: null });
  });

  it("sem chave do servidor (sem sessão), ou com o navegador recusando, não envia nada e não quebra", async () => {
    const semSessao = carregar({ chaveDoServidor: null });
    await disparar(semSessao.ouvintes, { oldSubscription: null, newSubscription: null });
    expect(semSessao.subscribe).not.toHaveBeenCalled();
    expect(semSessao.chamadas.some((c) => c.url === "/api/push/inscricao")).toBe(false);

    const recusado = carregar({ subscribe: async () => Promise.reject(new Error("push service error")) });
    await disparar(recusado.ouvintes, { oldSubscription: null, newSubscription: null });
    expect(recusado.chamadas.some((c) => c.url === "/api/push/inscricao")).toBe(false);
  });
});
