import { describe, expect, it } from "vitest";

import { pesoDoVeiculo, veiculoEhConhecido } from "./veiculos-conhecidos";

describe("veículos conhecidos", () => {
  it("reconhece sem acento, maiúscula nem pontuação; blog e vazio não", () => {
    expect(veiculoEhConhecido("g1")).toBe(true);
    expect(veiculoEhConhecido("Folha de S.Paulo")).toBe(true);
    expect(veiculoEhConhecido("ESTADAO")).toBe(true);
    expect(veiculoEhConhecido("Blog do Fulano")).toBe(false);
    expect(veiculoEhConhecido("")).toBe(false);
    expect(veiculoEhConhecido(null)).toBe(false);
    expect(pesoDoVeiculo("Exame")).toBe(1);
    expect(pesoDoVeiculo("Agregador qualquer")).toBe(0);
  });
});
