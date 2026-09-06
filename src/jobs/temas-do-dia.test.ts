import { describe, expect, it } from "vitest";

import type { TemaDoDia } from "@/db/schema";

import { evidenciaValida } from "./temas-do-dia";

function tema(dados: Partial<TemaDoDia> = {}): TemaDoDia {
  return {
    titulo: "tema de teste",
    descricao: "descricao",
    porQue: "esta subindo mais rapido que o normal da conta",
    evidencias: [],
    puxaPara: "alcance",
    ...dados,
  };
}

describe("evidenciaValida", () => {
  it("aprova com evidencia so de video", () => {
    const temas = [tema({ evidencias: [1] })];
    expect(evidenciaValida(temas, new Set([1]), new Set())).toBe(true);
  });

  it("aprova com evidencia so de noticia", () => {
    const temas = [tema({ evidenciasNoticias: [10] })];
    expect(evidenciaValida(temas, new Set(), new Set([10]))).toBe(true);
  });

  it("aprova com evidencia dos dois tipos", () => {
    const temas = [tema({ evidencias: [1], evidenciasNoticias: [10] })];
    expect(evidenciaValida(temas, new Set([1]), new Set([10]))).toBe(true);
  });

  it("reprova sem nenhuma evidencia", () => {
    const temas = [tema()];
    expect(evidenciaValida(temas, new Set([1]), new Set([10]))).toBe(false);
  });

  it("reprova id de video invalido (nao enviado ao modelo)", () => {
    const temas = [tema({ evidencias: [999] })];
    expect(evidenciaValida(temas, new Set([1]), new Set())).toBe(false);
  });

  it("reprova id de noticia invalido (nao enviado ao modelo)", () => {
    const temas = [tema({ evidenciasNoticias: [999] })];
    expect(evidenciaValida(temas, new Set(), new Set([10]))).toBe(false);
  });

  it("evidenciasNoticias ausente (tema antigo, sem o campo) conta como lista vazia, nao quebra", () => {
    const temas = [tema({ evidencias: [1] })];
    delete (temas[0] as { evidenciasNoticias?: number[] }).evidenciasNoticias;
    expect(evidenciaValida(temas, new Set([1]), new Set([10]))).toBe(true);
  });

  it("reprova quando so um dos varios temas nao tem evidencia", () => {
    const temas = [tema({ evidencias: [1] }), tema()];
    expect(evidenciaValida(temas, new Set([1]), new Set())).toBe(false);
  });
});
