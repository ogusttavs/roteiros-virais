/**
 * O `public/sw.js` depois do aviso por push (E48 PR 2): continua registrando tudo o que registrava (quem já instalou não pode quebrar) e ganha `push` e
 * `notificationclick`. O arquivo roda numa caixa de areia (`vm`) com um `self` falso que só guarda os ouvintes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

const SW = readFileSync(path.join(__dirname, "..", "..", "public", "sw.js"), "utf8");

type Ouvinte = (evento: Record<string, unknown>) => void;

function carregarSw() {
  const ouvintes = new Map<string, Ouvinte>();
  const notificacoes: { titulo: string; opcoes: Record<string, unknown> }[] = [];
  const abertas: string[] = [];
  const focadas: { url: string | null }[] = [];
  let janelas: { focus: () => Promise<{ navigate: (url: string) => Promise<void> }> }[] = [];

  const self = {
    addEventListener: (tipo: string, ouvinte: Ouvinte) => ouvintes.set(tipo, ouvinte),
    skipWaiting: () => Promise.resolve(),
    registration: {
      showNotification: (titulo: string, opcoes: Record<string, unknown>) => {
        notificacoes.push({ titulo, opcoes });
        return Promise.resolve();
      },
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(janelas),
      openWindow: (url: string) => {
        abertas.push(url);
        return Promise.resolve(null);
      },
    },
  };
  const caixa = vm.createContext({ self, caches: {}, fetch: () => Promise.reject(new Error("sem rede")), URL, Promise, console });
  vm.runInContext(SW, caixa);
  return {
    ouvintes,
    notificacoes,
    abertas,
    focadas,
    comJanelas(lista: typeof janelas) {
      janelas = lista;
    },
  };
}

function eventoPush(dados: unknown, semDados = false) {
  const esperas: Promise<unknown>[] = [];
  return {
    evento: {
      data: semDados ? null : { json: () => dados },
      waitUntil: (p: Promise<unknown>) => esperas.push(p),
    },
    esperar: () => Promise.all(esperas),
  };
}

describe("public/sw.js: o que já existia continua", () => {
  it("registra install, activate, fetch e message, além do push e do notificationclick", () => {
    const { ouvintes } = carregarSw();
    for (const tipo of ["install", "activate", "fetch", "message", "push", "notificationclick"]) {
      expect(ouvintes.has(tipo), tipo).toBe(true);
    }
  });

  it("os nomes de cache e a lista fechada de páginas seguem os de antes (a versão do cache não mudou)", () => {
    expect(SW).toContain('var VERSAO = "v1";');
    expect(SW).toContain('var PREFIXO_PAGINAS = "roteiros-paginas";');
    expect(SW).toContain("/^\\/roteiros\\/\\d+(\\/gravar)?$/");
    expect(SW).toContain("NUNCA guarda: /admin, /api");
  });
});

describe("push", () => {
  it("mostra a notificação com o título e o corpo do aviso, o ícone do app e a url no dado", async () => {
    const sw = carregarSw();
    const { evento, esperar } = eventoPush({ titulo: "Klaki", corpo: "O seu roteiro de hoje está pronto", url: "/hoje" });

    sw.ouvintes.get("push")!(evento);
    await esperar();

    expect(sw.notificacoes).toHaveLength(1);
    expect(sw.notificacoes[0].titulo).toBe("Klaki");
    expect(sw.notificacoes[0].opcoes).toMatchObject({ body: "O seu roteiro de hoje está pronto", icon: "/icone-192.png", data: { url: "/hoje" } });
  });

  it("push vazio ou com dado quebrado ainda mostra uma notificação (o navegador exige), com o aviso genérico", async () => {
    const sw = carregarSw();
    const vazio = eventoPush(null, true);
    sw.ouvintes.get("push")!(vazio.evento);
    await vazio.esperar();
    const quebrado = { data: { json: () => { throw new Error("json ruim"); } }, waitUntil: vi.fn() };
    sw.ouvintes.get("push")!(quebrado);

    expect(sw.notificacoes).toHaveLength(2);
    expect(sw.notificacoes[0].titulo).toBe("Aviso");
  });

  it("a url do aviso só vale se for um caminho do próprio app: endereço de fora e '//' viram /hoje", async () => {
    const sw = carregarSw();
    for (const url of ["https://outro.exemplo/x", "//outro.exemplo/x", "hoje", 42, undefined]) {
      const { evento, esperar } = eventoPush({ titulo: "t", corpo: "c", url });
      sw.ouvintes.get("push")!(evento);
      await esperar();
    }
    expect(sw.notificacoes.map((n) => (n.opcoes.data as { url: string }).url)).toEqual(["/hoje", "/hoje", "/hoje", "/hoje", "/hoje"]);
  });
});

describe("notificationclick", () => {
  it("fecha a notificação e foca a janela do app que já está aberta, levando-a ao caminho", async () => {
    const sw = carregarSw();
    const navegou: string[] = [];
    sw.comJanelas([{ focus: () => Promise.resolve({ navigate: (url: string) => (navegou.push(url), Promise.resolve()) }) }]);
    const esperas: Promise<unknown>[] = [];
    const fechou = vi.fn();

    sw.ouvintes.get("notificationclick")!({
      notification: { close: fechou, data: { url: "/roteiros/7" } },
      waitUntil: (p: Promise<unknown>) => esperas.push(p),
    });
    await Promise.all(esperas);

    expect(fechou).toHaveBeenCalled();
    expect(navegou).toEqual(["/roteiros/7"]);
    expect(sw.abertas).toEqual([]);
  });

  it("sem janela aberta, abre uma nova em /hoje", async () => {
    const sw = carregarSw();
    sw.comJanelas([]);
    const esperas: Promise<unknown>[] = [];

    sw.ouvintes.get("notificationclick")!({ notification: { close: vi.fn(), data: {} }, waitUntil: (p: Promise<unknown>) => esperas.push(p) });
    await Promise.all(esperas);

    expect(sw.abertas).toEqual(["/hoje"]);
  });
});
