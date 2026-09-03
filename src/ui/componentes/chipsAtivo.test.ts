import { describe, expect, it } from "vitest";

import { chipsAtivos } from "./chipsAtivo";

describe("chipsAtivos", () => {
  it("marca no maximo um ativo por grupo", () => {
    const ativos = chipsAtivos(4, 2);
    expect(ativos).toEqual([false, false, true, false]);
    expect(ativos.filter(Boolean)).toHaveLength(1);
  });

  it("nenhum ativo quando selecionado e nulo", () => {
    expect(chipsAtivos(3, null)).toEqual([false, false, false]);
  });
});
