import { describe, expect, it } from "vitest";

import { criarLimitador } from "./limite-de-taxa";

describe("criarLimitador", () => {
  it("deixa passar até o máximo na janela e recusa o seguinte", () => {
    const limitador = criarLimitador({ janelaMs: 1000, maximo: 3 });
    expect([1, 2, 3, 4].map(() => limitador.tentar("a", 100))).toEqual([true, true, true, false]);
  });

  it("a recusa não conta: quando a janela passa, volta a deixar", () => {
    const limitador = criarLimitador({ janelaMs: 1000, maximo: 1 });
    expect(limitador.tentar("a", 0)).toBe(true);
    expect(limitador.tentar("a", 500)).toBe(false);
    expect(limitador.tentar("a", 1001)).toBe(true);
  });

  it("cada chave tem a sua conta", () => {
    const limitador = criarLimitador({ janelaMs: 1000, maximo: 1 });
    expect(limitador.tentar("a", 0)).toBe(true);
    expect(limitador.tentar("b", 0)).toBe(true);
    expect(limitador.tentar("a", 1)).toBe(false);
  });

  it("varre as chaves velhas quando o mapa passa do teto, sem perder as recentes", () => {
    const limitador = criarLimitador({ janelaMs: 1000, maximo: 1 });
    for (let i = 0; i < 5_001; i++) limitador.tentar(`ip-${i}`, 0);
    // Tudo isso já saiu da janela; esta chamada dispara a varredura e uma chave velha volta a passar.
    expect(limitador.tentar("ip-0", 5000)).toBe(true);
    expect(limitador.tentar("ip-0", 5001)).toBe(false);
  });
});
