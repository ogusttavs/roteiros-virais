import { describe, expect, it } from "vitest";

import { encontrarProblemas } from "@/lib/regras-de-texto";

import { MOTIVOS_REPROVACAO, rotuloDoMotivo } from "./motivos-reprovacao";

describe("MOTIVOS_REPROVACAO", () => {
  it("tem oito motivos, todos com id unico", () => {
    expect(MOTIVOS_REPROVACAO).toHaveLength(8);
    const ids = new Set(MOTIVOS_REPROVACAO.map((m) => m.id));
    expect(ids.size).toBe(MOTIVOS_REPROVACAO.length);
  });

  it("nenhum rotulo tem travessao, emoji ou jargao", () => {
    for (const motivo of MOTIVOS_REPROVACAO) {
      expect(encontrarProblemas(motivo.rotulo)).toEqual([]);
    }
  });

  it("rotuloDoMotivo devolve o rotulo certo, e o proprio id para um id desconhecido", () => {
    expect(rotuloDoMotivo("gancho_fraco")).toBe("Gancho fraco");
    expect(rotuloDoMotivo("id_que_nao_existe")).toBe("id_que_nao_existe");
  });
});
