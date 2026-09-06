import { describe, expect, it } from "vitest";

import { estaAcimaDoNormal, estaNaHoraDeMedir, intervaloDeMedicaoH, normalizarHandle } from "./curva";

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;
const POSTADO_EM = new Date("2026-09-01T00:00:00Z");

function horasDepois(horas: number): Date {
  return new Date(POSTADO_EM.getTime() + horas * HORA_MS);
}

describe("intervaloDeMedicaoH", () => {
  it("1h nas primeiras 24h", () => {
    expect(intervaloDeMedicaoH(1)).toBe(1);
    expect(intervaloDeMedicaoH(24)).toBe(1);
  });

  it("6h de 24h a 72h", () => {
    expect(intervaloDeMedicaoH(25)).toBe(6);
    expect(intervaloDeMedicaoH(72)).toBe(6);
  });

  it("24h depois de 72h", () => {
    expect(intervaloDeMedicaoH(73)).toBe(24);
    expect(intervaloDeMedicaoH(24 * 30)).toBe(24);
  });
});

describe("estaNaHoraDeMedir (cadencia do escopo 4.8, relogio fabricado)", () => {
  it("1h: nunca medido, esta na hora (primeira medicao)", () => {
    expect(estaNaHoraDeMedir(POSTADO_EM, null, horasDepois(1))).toBe(true);
  });

  it("1h: medido ha 30 min, ainda nao (intervalo de 1h nao passou)", () => {
    const ultimaColeta = new Date(horasDepois(1).getTime() - 30 * 60 * 1000);
    expect(estaNaHoraDeMedir(POSTADO_EM, ultimaColeta, horasDepois(1))).toBe(false);
  });

  it("1h: medido ha exatamente 1h, esta na hora de novo", () => {
    const ultimaColeta = new Date(horasDepois(1).getTime() - HORA_MS);
    expect(estaNaHoraDeMedir(POSTADO_EM, ultimaColeta, horasDepois(1))).toBe(true);
  });

  it("25h: ultima medicao ha 1h (ainda na cadencia antiga), nao esta na hora (precisa de 6h agora)", () => {
    expect(estaNaHoraDeMedir(POSTADO_EM, horasDepois(24), horasDepois(25))).toBe(false);
  });

  it("25h: ultima medicao ha 6h, esta na hora", () => {
    expect(estaNaHoraDeMedir(POSTADO_EM, horasDepois(19), horasDepois(25))).toBe(true);
  });

  it("80h: ultima medicao ha 6h (cadencia de 24h agora), nao esta na hora", () => {
    expect(estaNaHoraDeMedir(POSTADO_EM, horasDepois(74), horasDepois(80))).toBe(false);
  });

  it("80h: ultima medicao ha 24h, esta na hora", () => {
    expect(estaNaHoraDeMedir(POSTADO_EM, horasDepois(56), horasDepois(80))).toBe(true);
  });

  it("10 dias: cadencia continua diaria, ultima medicao ha 23h nao basta, ha 24h esta na hora", () => {
    const dezDias = horasDepois(10 * 24);
    const ha23h = new Date(dezDias.getTime() - 23 * HORA_MS);
    const ha24h = new Date(dezDias.getTime() - 24 * HORA_MS);
    expect(estaNaHoraDeMedir(POSTADO_EM, ha23h, dezDias)).toBe(false);
    expect(estaNaHoraDeMedir(POSTADO_EM, ha24h, dezDias)).toBe(true);
  });

  it("31 dias: nunca mais, mesmo sem nenhuma medicao ainda", () => {
    const trintaEUmDias = new Date(POSTADO_EM.getTime() + 31 * DIA_MS);
    expect(estaNaHoraDeMedir(POSTADO_EM, null, trintaEUmDias)).toBe(false);
    expect(estaNaHoraDeMedir(POSTADO_EM, horasDepois(29 * 24), trintaEUmDias)).toBe(false);
  });

  it("exatamente 30 dias ainda conta (o limite e inclusive)", () => {
    const trintaDias = new Date(POSTADO_EM.getTime() + 30 * DIA_MS);
    expect(estaNaHoraDeMedir(POSTADO_EM, horasDepois(29 * 24), trintaDias)).toBe(true);
  });

  it("nunca mede um video com data de postagem no futuro", () => {
    expect(estaNaHoraDeMedir(horasDepois(5), null, POSTADO_EM)).toBe(false);
  });
});

describe("estaAcimaDoNormal", () => {
  it("2x ou mais e acima do normal", () => {
    expect(estaAcimaDoNormal(200, 100)).toBe(true);
    expect(estaAcimaDoNormal(199, 100)).toBe(false);
  });

  it("sem mediana (aprendendo), nunca acima do normal", () => {
    expect(estaAcimaDoNormal(1000, null)).toBe(false);
  });

  it("mediana zero nao divide por zero", () => {
    expect(estaAcimaDoNormal(10, 0)).toBe(false);
  });
});

/** Rodada de acabamento de 06/09, item 4: o cliente digita o perfil como quiser no briefing. */
describe("normalizarHandle", () => {
  it("youtube: sempre com @, mesmo se o cliente nao digitou", () => {
    expect(normalizarHandle("ninadobre", "youtube")).toBe("@ninadobre");
    expect(normalizarHandle("@ninadobre", "youtube")).toBe("@ninadobre");
  });

  it("tiktok: sempre sem @, mesmo se o cliente digitou com @", () => {
    expect(normalizarHandle("@ninadobre", "tiktok")).toBe("ninadobre");
    expect(normalizarHandle("ninadobre", "tiktok")).toBe("ninadobre");
  });

  it("instagram: sempre sem @, mesmo se o cliente digitou com @", () => {
    expect(normalizarHandle("@ninadobre", "instagram")).toBe("ninadobre");
    expect(normalizarHandle("ninadobre", "instagram")).toBe("ninadobre");
  });

  it("tira espaco em volta e no meio, de qualquer plataforma", () => {
    expect(normalizarHandle("  @ nina dobre  ", "tiktok")).toBe("ninadobre");
    expect(normalizarHandle(" nina dobre ", "youtube")).toBe("@ninadobre");
  });
});
