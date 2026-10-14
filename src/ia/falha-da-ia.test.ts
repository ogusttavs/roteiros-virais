import { describe, expect, it } from "vitest";

import { creditoAindaFalta, lerFalhaDaIA } from "./falha-da-ia";

const EM = new Date("2026-10-14T15:00:00.000Z");
const falha = (causa: "credito" | "sobrecarga" | "chave", em: Date = EM) => ({ causa, tarefa: "roteiro", em });

describe("lerFalhaDaIA", () => {
  it("lê o que foi guardado", () => {
    const lida = lerFalhaDaIA(JSON.stringify({ causa: "credito", tarefa: "roteiro", em: EM.toISOString() }));
    expect(lida).toEqual({ causa: "credito", tarefa: "roteiro", em: EM });
  });

  it.each([
    ["nada", null],
    ["vazio", ""],
    ["texto que não é JSON", "{quebrado"],
    ["causa desconhecida", JSON.stringify({ causa: "outra", tarefa: "x", em: EM.toISOString() })],
    ["sem data", JSON.stringify({ causa: "credito", tarefa: "x" })],
    ["data inválida", JSON.stringify({ causa: "credito", tarefa: "x", em: "ontem" })],
  ])("%s vira nenhuma falha", (_nome, valor) => {
    expect(lerFalhaDaIA(valor)).toBeNull();
  });

  it("a tarefa que não é texto vira vazia, sem derrubar", () => {
    expect(lerFalhaDaIA(JSON.stringify({ causa: "chave", tarefa: 5, em: EM.toISOString() }))?.tarefa).toBe("");
  });
});

describe("creditoAindaFalta", () => {
  it("vale a falta de crédito sem nenhuma geração boa depois dela", () => {
    expect(creditoAindaFalta(falha("credito"), null)?.causa).toBe("credito");
    expect(creditoAindaFalta(falha("credito"), new Date(EM.getTime() - 1000))?.causa).toBe("credito");
  });

  it("some quando uma geração deu certo depois (o crédito voltou)", () => {
    expect(creditoAindaFalta(falha("credito"), new Date(EM.getTime() + 1000))).toBeNull();
  });

  it("só a falta de crédito vira aviso: a sobrecarga passa sozinha e a chave não é desta rodada", () => {
    expect(creditoAindaFalta(falha("sobrecarga"), null)).toBeNull();
    expect(creditoAindaFalta(falha("chave"), null)).toBeNull();
    expect(creditoAindaFalta(null, null)).toBeNull();
  });
});
