/** A estimativa de custo que a tela diz antes de rodar a pesquisa (E54). O resto do serviço é provado contra o Postgres (`tests/integracao/pesquisa-na-hora.test.ts`). */
import { describe, expect, it } from "vitest";

import { estimarPesquisa } from "./pesquisa-na-hora";

describe("estimarPesquisa", () => {
  it("a normal sai por uns US$ 0,09 e a aprofundada por uns US$ 0,17, como na referência (uns R$ 0,50 e R$ 0,95)", () => {
    const normal = estimarPesquisa("normal");
    const funda = estimarPesquisa("aprofundada");
    expect(normal.buscas).toBe(5);
    expect(funda.buscas).toBe(10);
    expect(normal.usd).toBeCloseTo(0.0875, 4);
    expect(funda.usd).toBeCloseTo(0.1675, 4);
    expect(normal.reais).toBeCloseTo(0.48, 2);
    expect(funda.reais).toBeCloseTo(0.92, 2);
  });
});
