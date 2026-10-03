import { describe, expect, it } from "vitest";

import { ehRotaAtiva } from "./navAtivo";

describe("ehRotaAtiva", () => {
  it("marca ativa a rota igual ao caminho atual", () => {
    expect(ehRotaAtiva("/hoje", "/hoje")).toBe(true);
  });

  it("nao marca ativa uma rota diferente", () => {
    expect(ehRotaAtiva("/hoje", "/referencias")).toBe(false);
  });

  it("marca ativa a rota quando o caminho esta dentro dela (/criar/temas acende Criar), mas nao uma rota que so comeca igual", () => {
    expect(ehRotaAtiva("/criar/temas", "/criar")).toBe(true);
    expect(ehRotaAtiva("/criar/tema-livre", "/criar")).toBe(true);
    expect(ehRotaAtiva("/criarx", "/criar")).toBe(false);
    expect(ehRotaAtiva("/hoje", "/criar")).toBe(false);
  });

  it("nao marca nada ativo sem pathname (usePathname pode devolver nulo)", () => {
    expect(ehRotaAtiva(null, "/hoje")).toBe(false);
  });
});
