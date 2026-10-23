/**
 * E22 PR 3, o que se prova sem banco: com a cobrança desligada as funções devolvem todas as marcas liberadas SEM consultar o banco (o banco aqui lança se for tocado), e os
 * pedaços de resumo só aparecem quando alguma marca foi pulada. A prova com o banco de verdade está em `tests/integracao/assinatura-tarefas.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
  db: () => {
    throw new Error("o banco não deveria ser consultado");
  },
}));

import { filtrarPorAssinatura, marcaPodeReceberTarefa, resumoDasMarcasPuladas, separarMarcasPorAssinatura } from "./assinatura-tarefas";

describe("com a cobrança desligada nada muda e o banco nem é tocado", () => {
  it("separarMarcasPorAssinatura devolve todas liberadas, sem repetição", async () => {
    const { liberadas, puladas } = await separarMarcasPorAssinatura([3, 1, 3, 2], { cobrancaAtiva: false });
    expect([...liberadas].sort()).toEqual([1, 2, 3]);
    expect(puladas).toEqual([]);
  });

  it("filtrarPorAssinatura devolve os itens como vieram", async () => {
    const itens = [{ marca: 1 }, { marca: 2 }];
    expect(await filtrarPorAssinatura(itens, (i) => i.marca, { cobrancaAtiva: false })).toEqual({ itens, marcasPuladas: 0 });
  });

  it("marcaPodeReceberTarefa é sempre verdadeiro", async () => {
    expect(await marcaPodeReceberTarefa(42, { cobrancaAtiva: false })).toBe(true);
  });
});

describe("com a cobrança ligada e nenhuma marca, também não consulta", () => {
  it("lista vazia", async () => {
    expect(await separarMarcasPorAssinatura([], { cobrancaAtiva: true })).toEqual({ liberadas: new Set(), puladas: [] });
  });
});

describe("resumoDasMarcasPuladas", () => {
  it("zero marcas: nenhum campo (o resumo de quem não cobra fica igual ao de sempre)", () => {
    expect(resumoDasMarcasPuladas(0)).toEqual({});
  });
  it("com marcas puladas: o campo aparece", () => {
    expect(resumoDasMarcasPuladas(2)).toEqual({ marcasPuladasPorAssinatura: 2 });
  });
});
