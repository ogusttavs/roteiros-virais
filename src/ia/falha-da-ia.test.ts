import { describe, expect, it } from "vitest";

import { falhaQueTrancaAindaVale, lerFalhaDaIA } from "./falha-da-ia";

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

describe("falhaQueTrancaAindaVale", () => {
  it.each(["credito", "chave"] as const)("vale a falha por %s sem nenhuma geração boa depois dela", (causa) => {
    expect(falhaQueTrancaAindaVale(falha(causa), null)?.causa).toBe(causa);
    expect(falhaQueTrancaAindaVale(falha(causa), new Date(EM.getTime() - 1000))?.causa).toBe(causa);
  });

  it.each(["credito", "chave"] as const)("a falha por %s some quando uma geração deu certo depois (a IA voltou)", (causa) => {
    expect(falhaQueTrancaAindaVale(falha(causa), new Date(EM.getTime() + 1000))).toBeNull();
  });

  it("a sobrecarga passa sozinha e nunca vira aviso", () => {
    expect(falhaQueTrancaAindaVale(falha("sobrecarga"), null)).toBeNull();
    expect(falhaQueTrancaAindaVale(null, null)).toBeNull();
  });
});
