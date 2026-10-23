/** A regra de decisão da faxina das contas fora do setor (22/10/2026): pura, sem banco. */
import { describe, expect, it } from "vitest";

import { decidirContaDoSetor, motivoDaMarca, type RegrasDaFaxina } from "./contas-fora-do-setor";

const REGRAS: RegrasDaFaxina = { minimoDeVideos: 5, proporcaoFora: 0.5 };

describe("decidirContaDoSetor", () => {
  it("a maioria dos vídeos conferidos fora do setor marca a conta", () => {
    expect(decidirContaDoSetor(8, 6, REGRAS)).toBe("fora");
    expect(decidirContaDoSetor(5, 3, REGRAS)).toBe("fora");
    expect(decidirContaDoSetor(8, 8, REGRAS)).toBe("fora");
  });

  it("metade exata não basta: na dúvida a conta fica", () => {
    expect(decidirContaDoSetor(8, 4, REGRAS)).toBe("do_setor");
    expect(decidirContaDoSetor(6, 3, REGRAS)).toBe("do_setor");
  });

  it("minoria fora ou nenhum fora: a conta é do setor", () => {
    expect(decidirContaDoSetor(8, 3, REGRAS)).toBe("do_setor");
    expect(decidirContaDoSetor(8, 0, REGRAS)).toBe("do_setor");
    expect(decidirContaDoSetor(5, 2, REGRAS)).toBe("do_setor");
  });

  it("abaixo do mínimo de vídeos conferidos não decide, mesmo com todos fora", () => {
    expect(decidirContaDoSetor(4, 4, REGRAS)).toBe("sem_base");
    expect(decidirContaDoSetor(0, 0, REGRAS)).toBe("sem_base");
    expect(decidirContaDoSetor(1, 1, REGRAS)).toBe("sem_base");
  });

  it("o mínimo e a proporção vêm das regras", () => {
    expect(decidirContaDoSetor(3, 3, { minimoDeVideos: 3, proporcaoFora: 0.5 })).toBe("fora");
    expect(decidirContaDoSetor(8, 5, { minimoDeVideos: 5, proporcaoFora: 0.75 })).toBe("do_setor");
    expect(decidirContaDoSetor(8, 7, { minimoDeVideos: 5, proporcaoFora: 0.75 })).toBe("fora");
  });

  it("sem regras passadas usa as de config (mínimo 5, mais da metade)", () => {
    expect(decidirContaDoSetor(4, 4)).toBe("sem_base");
    expect(decidirContaDoSetor(8, 5)).toBe("fora");
    expect(decidirContaDoSetor(8, 4)).toBe("do_setor");
  });
});

describe("motivoDaMarca", () => {
  it("diz quantos de quantos e dá até dois títulos de exemplo", () => {
    expect(motivoDaMarca(8, 6, ["Curiosidade um", "Curiosidade dois", "Curiosidade três"])).toBe("6 de 8 vídeos conferidos são de outro assunto (por exemplo: Curiosidade um; Curiosidade dois)");
  });

  it("sem título, só a contagem; título com quebra de linha e comprido é aparado", () => {
    expect(motivoDaMarca(5, 3, [])).toBe("3 de 5 vídeos conferidos são de outro assunto");
    expect(motivoDaMarca(5, 3, ["   ", ""])).toBe("3 de 5 vídeos conferidos são de outro assunto");
    const motivo = motivoDaMarca(5, 3, ["linha um\nlinha dois  " + "x".repeat(200)]);
    expect(motivo).not.toContain("\n");
    expect(motivo.length).toBeLessThan(160);
  });
});
