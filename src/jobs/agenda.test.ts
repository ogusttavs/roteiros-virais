import { afterEach, describe, expect, it } from "vitest";

import { config } from "@/lib/config";

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

  it("contasBase roda as 03:40, antes de pontuar as 03:45 (E6 parte 3, item 5: catch-up antes da mediana do dia)", () => {
    expect(cronDe(FILAS.contasBase)).toBe("40 3 * * *");
    expect(cronDe(FILAS.pontuar)).toBe("45 3 * * *");
  });

  it("cada fila e chave aparecem no maximo uma vez", () => {
    const chaves = AGENDAMENTOS.map((a) => `${a.fila}::${a.chave ?? ""}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("metaContas roda as 03:35, entre a coleta do apify (03:30) e o contas-base (03:40)", () => {
    expect(cronDe(FILAS.coletaApify)).toBe("30 3 * * *");
    expect(cronDe(FILAS.metaContas)).toBe("35 3 * * *");
    expect(cronDe(FILAS.contasBase)).toBe("40 3 * * *");
  });

  it("metaHashtags roda todo dia as 04:20, entre transcrever (04:00) e extrair (05:00) (ajuste 2 da revisao do PR #35: recent_media e janela de 24h)", () => {
    expect(cronDe(FILAS.transcrever)).toBe("0 4 * * *");
    expect(cronDe(FILAS.metaHashtags)).toBe("20 4 * * *");
    expect(cronDe(FILAS.extrair)).toBe("0 5 * * *");
  });

  it("vigilancia roda todo dia as 04:30 (E6 parte 3, terceira rodada, item 8: nao mais so domingo)", () => {
    const agendamento = AGENDAMENTOS.find((a) => a.fila === FILAS.vigilancia);
    expect(agendamento?.cron).toBe("30 4 * * *");
  });

  it("coletaMeioDia roda as 12:00 (E6 parte 3, terceira rodada, item 6)", () => {
    expect(cronDe(FILAS.coletaMeioDia)).toBe("0 12 * * *");
  });

  describe("metaContas aparece duas vezes (E6 parte 3, terceira rodada, item 10)", () => {
    afterEach(() => {
      config.coleta.metaAtivo = false;
      config.coleta.coletaMeioDia = false;
    });

    it("so com metaAtivo, uma vez (a das 03:35)", () => {
      config.coleta.metaAtivo = true;
      const agendamentos = AGENDAMENTOS.filter((a) => a.fila === FILAS.metaContas && (a.condicao?.() ?? true));
      expect(agendamentos).toHaveLength(1);
      expect(agendamentos[0].cron).toBe("35 3 * * *");
    });

    it("com metaAtivo e coletaMeioDia, duas vezes (03:35 e 11:55, antes da passada do meio-dia)", () => {
      config.coleta.metaAtivo = true;
      config.coleta.coletaMeioDia = true;
      const agendamentos = AGENDAMENTOS.filter((a) => a.fila === FILAS.metaContas && (a.condicao?.() ?? true));
      expect(agendamentos.map((a) => a.cron).sort()).toEqual(["35 3 * * *", "55 11 * * *"]);
    });
  });

  describe("metaContas so agenda com config.coleta.metaAtivo (E6 parte 3, segunda rodada, item 1)", () => {
    afterEach(() => {
      config.coleta.metaAtivo = false;
    });

    it("condicao reflete metaAtivo desligado", () => {
      config.coleta.metaAtivo = false;
      const agendamento = AGENDAMENTOS.find((a) => a.fila === FILAS.metaContas);
      expect(agendamento?.condicao?.()).toBe(false);
    });

    it("condicao reflete metaAtivo ligado", () => {
      config.coleta.metaAtivo = true;
      const agendamento = AGENDAMENTOS.find((a) => a.fila === FILAS.metaContas);
      expect(agendamento?.condicao?.()).toBe(true);
    });
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
