/**
 * Os pedaços do aviso por push que não dependem do navegador (E48 PR 2): a chave pública VAPID vira os bytes que o `pushManager.subscribe` pede.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { chaveDaInscricaoConfere, chaveParaBytes, ligarAviso, reinscreverAvisoSeFaltar } from "./push";

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

describe("chaveDaInscricaoConfere (a chave VAPID trocada deixava o aviso morrer em silêncio)", () => {
  const CHAVE = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
  const OUTRA = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";

  it("a mesma chave confere; outra chave (ou tamanho diferente) não", () => {
    expect(chaveDaInscricaoConfere(chaveParaBytes(CHAVE).buffer, CHAVE)).toBe(true);
    expect(chaveDaInscricaoConfere(chaveParaBytes(OUTRA).buffer, CHAVE)).toBe(false);
    expect(chaveDaInscricaoConfere(chaveParaBytes("AQID").buffer, CHAVE)).toBe(false);
  });

  it("sem chave guardada na inscrição, ou com uma chave do servidor ilegível, não força uma inscrição nova", () => {
    expect(chaveDaInscricaoConfere(null, CHAVE)).toBe(true);
    expect(chaveDaInscricaoConfere(undefined, CHAVE)).toBe(true);
    expect(chaveDaInscricaoConfere(chaveParaBytes(CHAVE).buffer, "***")).toBe(true);
  });
});

describe("reinscreverAvisoSeFaltar", () => {
  const CHAVE = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
  const OUTRA = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";

  function aparelho(opcoes: { permissao?: string; chaveGuardada?: string; temInscricao?: boolean; subscribe?: () => Promise<unknown> }) {
    const desinscrito = vi.fn(async () => true);
    const subscribe = vi.fn(opcoes.subscribe ?? (async () => ({ toJSON: () => ({ endpoint: "https://web.push.apple.com/novo", keys: { p256dh: "a", auth: "b" } }) })));
    const atual = {
      endpoint: "https://web.push.apple.com/velho",
      options: { applicationServerKey: chaveParaBytes(opcoes.chaveGuardada ?? CHAVE).buffer },
      unsubscribe: desinscrito,
    };
    const registro = { pushManager: { getSubscription: async () => (opcoes.temInscricao === false ? null : atual), subscribe } };
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => registro } });
    vi.stubGlobal("window", { PushManager: {}, Notification: {} });
    vi.stubGlobal("Notification", { permission: opcoes.permissao ?? "granted" });
    return { subscribe, desinscrito };
  }

  afterEach(() => vi.unstubAllGlobals());

  it("tudo certo (a chave é a de hoje e o servidor tem a inscrição): não faz nada", async () => {
    const { subscribe } = aparelho({});
    expect(await reinscreverAvisoSeFaltar(CHAVE, async () => true)).toEqual({ tipo: "nada" });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("a inscrição é de outra chave: reinscreve com a de hoje e devolve o endereço antigo, sem perguntar ao servidor se precisa", async () => {
    const { subscribe, desinscrito } = aparelho({ chaveGuardada: OUTRA });
    const resultado = await reinscreverAvisoSeFaltar(CHAVE, async () => true);
    expect(resultado).toEqual({
      tipo: "ligado",
      inscricao: { endpoint: "https://web.push.apple.com/novo", p256dh: "a", auth: "b" },
      endpointAntigo: "https://web.push.apple.com/velho",
    });
    expect(desinscrito).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("o servidor não tem a inscrição (apagada por falha): reinscreve", async () => {
    aparelho({});
    expect((await reinscreverAvisoSeFaltar(CHAVE, async () => false)).tipo).toBe("ligado");
  });

  it("sem permissão dada, ou sem inscrição no aparelho (quem desligou de propósito), não religa", async () => {
    const semPermissao = aparelho({ permissao: "default", chaveGuardada: OUTRA });
    expect(await reinscreverAvisoSeFaltar(CHAVE, async () => false)).toEqual({ tipo: "nada" });
    expect(semPermissao.subscribe).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    const semInscricao = aparelho({ temInscricao: false });
    expect(await reinscreverAvisoSeFaltar(CHAVE, async () => false)).toEqual({ tipo: "nada" });
    expect(semInscricao.subscribe).not.toHaveBeenCalled();
  });

  it("o navegador recusando a nova inscrição devolve o erro com a etapa", async () => {
    aparelho({ chaveGuardada: OUTRA, subscribe: async () => Promise.reject(new DOMException("push service error", "AbortError")) });
    expect(await reinscreverAvisoSeFaltar(CHAVE, async () => true)).toEqual({ tipo: "erro", etapa: "assinatura", motivo: "AbortError: push service error" });
  });
});
