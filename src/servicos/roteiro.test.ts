import { describe, expect, it } from "vitest";

import type { TipoAbertura } from "@/db/schema";

import { escolherTipoAbertura } from "./roteiro";

function evidencia(
  tipoAbertura: TipoAbertura | null,
  foraDaCurva: number,
  gancho: string,
  contaBrasileira = true,
): { tipoAbertura: TipoAbertura | null; foraDaCurva: number; contaBrasileira: boolean; gancho: string } {
  return { tipoAbertura, foraDaCurva, contaBrasileira, gancho };
}

/**
 * V4, item 3: função pura, testada com tabela de casos. Cobre as cinco
 * alíneas do plano (a a e) uma a uma.
 */
describe("escolherTipoAbertura", () => {
  it("(a e c) sem historico, escolhe o tipo de evidencia mais forte (maior fora da curva)", () => {
    const instrucao = escolherTipoAbertura(
      [evidencia("cena", 3, "olha essa cena"), evidencia("resultado", 8, "olha o resultado")],
      [],
    );
    expect(instrucao).toEqual({ tipo: "resultado", ganchoExemplo: "olha o resultado" });
  });

  it("(c) empate no fora da curva: o brasileiro vence", () => {
    const instrucao = escolherTipoAbertura(
      [
        evidencia("cena", 5, "gancho internacional", false),
        evidencia("resultado", 5, "gancho brasileiro", true),
      ],
      [],
    );
    expect(instrucao).toEqual({ tipo: "resultado", ganchoExemplo: "gancho brasileiro" });
  });

  it("(b) tira da escolha o tipo ja usado nos ultimos roteiros, mesmo sendo o mais forte", () => {
    const instrucao = escolherTipoAbertura(
      [evidencia("cena", 9, "gancho forte"), evidencia("resultado", 2, "gancho fraco")],
      ["cena"],
    );
    expect(instrucao).toEqual({ tipo: "resultado", ganchoExemplo: "gancho fraco" });
  });

  it("(b) ignora nulo na lista de ultimos tipos (roteiro de antes desta coluna existir)", () => {
    const instrucao = escolherTipoAbertura([evidencia("cena", 5, "gancho")], [null, null]);
    expect(instrucao).toEqual({ tipo: "cena", ganchoExemplo: "gancho" });
  });

  it("(d) nenhum tipo sobra fora dos ultimos usados: libera o usado ha mais tempo", () => {
    // "cena" e "resultado" sao os dois unicos tipos da evidencia, e os dois ja
    // apareceram nos ultimos roteiros; "cena" foi usado mais recentemente
    // (indice 0), "resultado" ha mais tempo (indice 2): libera "resultado".
    const instrucao = escolherTipoAbertura(
      [evidencia("cena", 9, "gancho cena"), evidencia("resultado", 2, "gancho resultado")],
      ["cena", "outro", "resultado"],
    );
    expect(instrucao).toEqual({ tipo: "resultado", ganchoExemplo: "gancho resultado" });
  });

  it("(d) com um unico tipo na evidencia, sempre libera ele de novo (nada mais para escolher)", () => {
    const instrucao = escolherTipoAbertura([evidencia("cena", 9, "gancho")], ["cena"]);
    expect(instrucao).toEqual({ tipo: "cena", ganchoExemplo: "gancho" });
  });

  it("(e) nenhuma evidencia tem tipo (nicho novo): so a lista do que evitar, sem tipo escolhido", () => {
    const instrucao = escolherTipoAbertura(
      [evidencia(null, 6, "gancho sem tipo")],
      ["cena", "resultado", "cena"],
    );
    expect(instrucao).toEqual({ tipo: null, tiposProibidos: expect.arrayContaining(["cena", "resultado"]) });
    expect((instrucao as { tiposProibidos: string[] }).tiposProibidos).toHaveLength(2);
  });

  it("(e) sem evidencia nenhuma e sem historico: livre, nada a evitar", () => {
    const instrucao = escolherTipoAbertura([], []);
    expect(instrucao).toEqual({ tipo: null, tiposProibidos: [] });
  });
});
