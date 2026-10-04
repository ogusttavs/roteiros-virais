/**
 * Os pedaços do aviso por push que não dependem do navegador (E48 PR 2): a chave pública VAPID vira os bytes que o `pushManager.subscribe` pede.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { chaveParaBytes, ligarAviso } from "./push";

describe("chaveParaBytes", () => {
  it("decodifica a chave pública no formato de URL (base64 com - e _, sem preenchimento) nos 65 bytes de uma chave P-256", () => {
    const bytes = chaveParaBytes("BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U");

    expect(bytes.length).toBe(65);
    // Uma chave pública P-256 sem compressão começa com 0x04.
    expect(bytes[0]).toBe(0x04);
  });

  it("aceita preenchimento ausente e troca - e _ pelos caracteres do base64 comum", () => {
    expect(Array.from(chaveParaBytes("-_8"))).toEqual([0xfb, 0xff]);
    expect(Array.from(chaveParaBytes("AQID"))).toEqual([1, 2, 3]);
  });
});

describe("ligarAviso: em que passo falhou (item 0d)", () => {
  const CHAVE = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

  function navegador(opcoes: { permissao?: string; subscribe?: () => Promise<unknown>; ready?: Promise<unknown>; register?: () => Promise<unknown> }) {
    const registro = {
      pushManager: { getSubscription: async () => null, subscribe: opcoes.subscribe ?? (async () => ({ toJSON: () => ({ endpoint: "https://web.push.apple.com/x", keys: { p256dh: "a", auth: "b" } }) })) },
    };
    vi.stubGlobal("navigator", { serviceWorker: { register: opcoes.register ?? (async () => registro), ready: opcoes.ready ?? Promise.resolve(registro) } });
    vi.stubGlobal("window", { PushManager: {}, Notification: {} });
    vi.stubGlobal("Notification", { permission: "default", requestPermission: async () => opcoes.permissao ?? "granted" });
  }

  afterEach(() => vi.unstubAllGlobals());

  it("o subscribe rejeitando devolve a etapa 'assinatura' com o nome e a mensagem do erro", async () => {
    navegador({ subscribe: async () => Promise.reject(new DOMException("Registration failed - push service error", "AbortError")) });
    const resultado = await ligarAviso(CHAVE);
    expect(resultado).toEqual({ tipo: "erro", etapa: "assinatura", motivo: "AbortError: Registration failed - push service error" });
  });

  it("o registro do service worker falhando devolve a etapa 'registro'", async () => {
    navegador({ register: async () => Promise.reject(new TypeError("Failed to register a ServiceWorker")) });
    const resultado = await ligarAviso(CHAVE);
    expect(resultado).toEqual({ tipo: "erro", etapa: "registro", motivo: "TypeError: Failed to register a ServiceWorker" });
  });

  it("a permissão negada é 'negado', e uma inscrição sem chaves é 'sem chaves na inscrição'", async () => {
    navegador({ permissao: "denied" });
    expect(await ligarAviso(CHAVE)).toEqual({ tipo: "negado" });
    vi.unstubAllGlobals();
    navegador({ subscribe: async () => ({ toJSON: () => ({ endpoint: "https://web.push.apple.com/x" }) }) });
    expect(await ligarAviso(CHAVE)).toEqual({ tipo: "erro", etapa: "inscricao", motivo: "sem chaves na inscrição" });
  });

  it("uma chave pública que não tem 65 bytes (ou com sobra de espaço ou quebra de linha) é a etapa 'chave', antes de pedir qualquer coisa ao navegador", async () => {
    navegador({});
    const curta = await ligarAviso("AQID");
    expect(curta).toMatchObject({ tipo: "erro", etapa: "chave" });
    // Com uma quebra de linha no fim, a chave boa continua valendo (o servidor a lê do ambiente).
    const comQuebra = await ligarAviso(`${CHAVE}\n`);
    expect(comQuebra.tipo).toBe("ligado");
  });
});
