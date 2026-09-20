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
});
