import { describe, expect, it } from "vitest";

import { forcaDaEvidencia, type EvidenciaParaForca } from "./forca-evidencia";

const HOJE = new Date("2026-09-20T12:00:00Z");
function diasAtras(dias: number): Date {
  return new Date(HOJE.getTime() - dias * 24 * 60 * 60 * 1000);
}

function evidencia(parcial: Partial<EvidenciaParaForca> = {}): EvidenciaParaForca {
  return {
    contaId: 1,
    foraDaCurva: 4,
    publicadoEm: diasAtras(2),
    contaBrasileira: true,
    ...parcial,
  };
}

describe("forcaDaEvidencia", () => {
  it("sem nenhuma evidencia, fraca", () => {
    expect(forcaDaEvidencia([])).toBe("fraca");
  });

  it("tres videos, duas contas, multiplo alto, recente e brasileiro: forte", () => {
    const evidencias = [
      evidencia({ contaId: 1, foraDaCurva: 5 }),
      evidencia({ contaId: 2, foraDaCurva: 3.2 }),
      evidencia({ contaId: 2, foraDaCurva: 4 }),
    ];
    expect(forcaDaEvidencia(evidencias, HOJE)).toBe("forte");
  });

  it("um video so, mesmo com multiplo altissimo: fraca (um video nao e padrao)", () => {
    const evidencias = [evidencia({ contaId: 1, foraDaCurva: 20 })];
    expect(forcaDaEvidencia(evidencias, HOJE)).toBe("fraca");
  });

  it("duas contas mas multiplo baixo: media, nao forte", () => {
    const evidencias = [
      evidencia({ contaId: 1, foraDaCurva: 1.8 }),
      evidencia({ contaId: 2, foraDaCurva: 2 }),
      evidencia({ contaId: 2, foraDaCurva: 1.9 }),
    ];
    expect(forcaDaEvidencia(evidencias, HOJE)).toBe("media");
  });

  it("evidencia com mais de 30 dias: fraca, mesmo com tres contas e multiplo alto", () => {
    const evidencias = [
      evidencia({ contaId: 1, foraDaCurva: 5, publicadoEm: diasAtras(40) }),
      evidencia({ contaId: 2, foraDaCurva: 4, publicadoEm: diasAtras(45) }),
      evidencia({ contaId: 3, foraDaCurva: 6, publicadoEm: diasAtras(50) }),
    ];
    expect(forcaDaEvidencia(evidencias, HOJE)).toBe("fraca");
  });

  it("maioria internacional: nunca forte, mesmo com o resto em dia", () => {
    const evidencias = [
      evidencia({ contaId: 1, foraDaCurva: 5, contaBrasileira: false }),
      evidencia({ contaId: 2, foraDaCurva: 4, contaBrasileira: false }),
      evidencia({ contaId: 3, foraDaCurva: 6, contaBrasileira: true }),
    ];
    expect(forcaDaEvidencia(evidencias, HOJE)).toBe("media");
  });

  it("video sem publicadoEm conta como mais antigo (nunca deixa a idade quebrar o calculo)", () => {
    const evidencias = [
      evidencia({ contaId: 1, foraDaCurva: 5, publicadoEm: null }),
      evidencia({ contaId: 2, foraDaCurva: 4, publicadoEm: diasAtras(45) }),
    ];
    expect(forcaDaEvidencia(evidencias, HOJE)).toBe("fraca");
  });

  /**
   * E42a, item 4 (decisão delegada pelo Gustavo ao Fable em 02/10): a proporção mínima não é mais
   * fixa em 70%, lê a régua do setor. O mesmo caso de "maioria internacional: nunca forte" acima
   * (1 de 3 brasileiro, ~33%) vira "forte" com a régua do setor ajustada para 30%.
   */
  it("régua do setor em 30%: maioria internacional pode ser forte, quando antes nunca era", () => {
    const evidencias = [
      evidencia({ contaId: 1, foraDaCurva: 5, contaBrasileira: false }),
      evidencia({ contaId: 2, foraDaCurva: 4, contaBrasileira: false }),
      evidencia({ contaId: 3, foraDaCurva: 6, contaBrasileira: true }),
    ];
    expect(forcaDaEvidencia(evidencias, HOJE, 0.3)).toBe("forte");
  });

  it("régua do setor em 90%: 75% brasileiro é forte no padrão de 70%, mas não a 90%", () => {
    const evidencias = [
      evidencia({ contaId: 1, foraDaCurva: 5, contaBrasileira: true }),
      evidencia({ contaId: 2, foraDaCurva: 4, contaBrasileira: true }),
      evidencia({ contaId: 3, foraDaCurva: 4, contaBrasileira: true }),
      evidencia({ contaId: 4, foraDaCurva: 4, contaBrasileira: false }),
    ];
    expect(forcaDaEvidencia(evidencias, HOJE)).toBe("forte");
    expect(forcaDaEvidencia(evidencias, HOJE, 0.9)).toBe("media");
  });
});
