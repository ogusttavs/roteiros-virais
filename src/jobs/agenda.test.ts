import { describe, expect, it } from "vitest";

import { AGENDAMENTOS, listarAgendamentos } from "./agenda";
import { FILAS } from "./fila";

function cronDe(fila: string, chave?: string): string | undefined {
  return AGENDAMENTOS.find((a) => a.fila === fila && a.chave === chave)?.cron;
}

describe("AGENDAMENTOS", () => {
  it("extrairColeta roda de hora em hora, aos 20 minutos (correcao do dia 1 da etapa 14)", () => {
    expect(cronDe(FILAS.extrairColeta)).toBe("20 * * * *");
  });

  it("temasDoDia roda as 06:30, depois do resultado da extracao (correcao do dia 1 da etapa 14)", () => {
    expect(cronDe(FILAS.temasDoDia)).toBe("30 6 * * *");
  });

  it("cada fila e chave aparecem no maximo uma vez", () => {
    const chaves = AGENDAMENTOS.map((a) => `${a.fila}::${a.chave ?? ""}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

describe("listarAgendamentos", () => {
  it("lista todo mundo, uma linha por agendamento", () => {
    const linhas = listarAgendamentos().split("\n");
    expect(linhas).toHaveLength(AGENDAMENTOS.length);
  });

  it("cada linha tem a fila e o cron", () => {
    const linhas = listarAgendamentos().split("\n");
    for (const [i, agendamento] of AGENDAMENTOS.entries()) {
      expect(linhas[i]).toContain(agendamento.fila);
      expect(linhas[i]).toContain(agendamento.cron);
    }
  });
});
