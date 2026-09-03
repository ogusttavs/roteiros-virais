import { describe, expect, it } from "vitest";

import { ehRotaAtiva } from "./navAtivo";

describe("ehRotaAtiva", () => {
  it("marca ativa a rota igual ao caminho atual", () => {
    expect(ehRotaAtiva("/hoje", "/hoje")).toBe(true);
  });

  it("nao marca ativa uma rota diferente", () => {
    expect(ehRotaAtiva("/hoje", "/referencias")).toBe(false);
  });

  it("nao marca nada ativo sem pathname (usePathname pode devolver nulo)", () => {
    expect(ehRotaAtiva(null, "/hoje")).toBe(false);
  });
});
