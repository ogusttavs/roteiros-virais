/**
 * `src/lib/estado-de-rede.ts` (V7, item 8 do PROXIMO.md): "sem rede" e
 * `navigator.onLine` falso OU a pagina na tela ter sido servida do guardado
 * (marca `Server-Timing: guardado` do service worker). Cada teste importa o
 * modulo de novo (`vi.resetModules`), porque o estado e do modulo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Ambiente = { onLine: boolean; guardado: boolean };

function prepararAmbiente({ onLine, guardado }: Ambiente) {
  const janela = new EventTarget();
  vi.stubGlobal("window", janela);
  vi.stubGlobal("navigator", { onLine });
  vi.stubGlobal("performance", {
    getEntriesByType: () => [{ serverTiming: guardado ? [{ name: "guardado" }] : [] }],
  });
  return janela;
}

async function carregar() {
  vi.resetModules();
  return import("./estado-de-rede");
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("estado da rede", () => {
  it("com rede e pagina da rede: nao esta sem rede", async () => {
    prepararAmbiente({ onLine: true, guardado: false });
    const { lerSemRede } = await carregar();

    expect(lerSemRede()).toBe(false);
  });

  it("navigator.onLine falso: sem rede", async () => {
    prepararAmbiente({ onLine: false, guardado: false });
    const { lerSemRede } = await carregar();

    expect(lerSemRede()).toBe(true);
  });

  it("pagina servida do guardado: sem rede mesmo com navigator.onLine verdadeiro (sinal fraco, portal de wifi)", async () => {
    prepararAmbiente({ onLine: true, guardado: true });
    const { lerSemRede, paginaEstaNoGuardado } = await carregar();

    expect(paginaEstaNoGuardado()).toBe(true);
    expect(lerSemRede()).toBe(true);
  });

  it("o evento online limpa a marca do guardado e avisa quem assina", async () => {
    const janela = prepararAmbiente({ onLine: true, guardado: true });
    const { lerSemRede, assinarEstadoDeRede } = await carregar();
    const ouvinte = vi.fn();
    assinarEstadoDeRede(ouvinte);
    expect(lerSemRede()).toBe(true);

    janela.dispatchEvent(new Event("online"));

    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(lerSemRede()).toBe(false);
  });

  it("o evento online avisa quem assina mesmo quando a pagina veio da rede (a faixa de navigator.onLine some)", async () => {
    const janela = prepararAmbiente({ onLine: true, guardado: false });
    const { assinarEstadoDeRede } = await carregar();
    const ouvinte = vi.fn();
    assinarEstadoDeRede(ouvinte);

    janela.dispatchEvent(new Event("online"));

    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it("o evento offline avisa quem assina", async () => {
    const janela = prepararAmbiente({ onLine: true, guardado: false });
    const { assinarEstadoDeRede } = await carregar();
    const ouvinte = vi.fn();
    assinarEstadoDeRede(ouvinte);

    janela.dispatchEvent(new Event("offline"));

    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it("uma conferencia que deu certo (avisarRedeVoltou) limpa a marca e avisa; sem marca nao avisa", async () => {
    prepararAmbiente({ onLine: true, guardado: true });
    const { lerSemRede, assinarEstadoDeRede, avisarRedeVoltou } = await carregar();
    const ouvinte = vi.fn();
    assinarEstadoDeRede(ouvinte);

    avisarRedeVoltou();
    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(lerSemRede()).toBe(false);

    avisarRedeVoltou();
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it("quem para de assinar nao e mais avisado", async () => {
    const janela = prepararAmbiente({ onLine: true, guardado: false });
    const { assinarEstadoDeRede } = await carregar();
    const ouvinte = vi.fn();
    const parar = assinarEstadoDeRede(ouvinte);
    parar();

    janela.dispatchEvent(new Event("offline"));

    expect(ouvinte).not.toHaveBeenCalled();
  });
});
