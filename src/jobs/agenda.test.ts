import { afterEach, describe, expect, it, vi } from "vitest";

import { config } from "@/lib/config";

import { AGENDAMENTOS, AGENDAMENTOS_APOSENTADOS, agendarTudo, listarAgendamentos } from "./agenda";
import { boss, FILAS } from "./fila";

vi.mock("./fila", async (importOriginal) => ({ ...(await importOriginal<typeof import("./fila")>()), boss: vi.fn() }));

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

  it("contasBase roda as 02:35, antes de pontuar as 03:45 (E6 parte 3, item 5: catch-up antes da mediana do dia)", () => {
    expect(cronDe(FILAS.contasBase)).toBe("35 2 * * *");
    expect(cronDe(FILAS.pontuar)).toBe("45 3 * * *");
  });

  /**
   * E38 PR 2: o despachante diario das 01:30 (por idade, nao por calendario: o cron do pg-boss nao
   * recupera um disparo perdido). Antes da coleta das 03:00 e longe da pesquisa de setor, que so roda
   * no dia 1 as 02:00.
   */
  it("entenderMarca despacha todo dia as 01:30, antes da coleta e sem colidir com a pesquisa de setor", () => {
    expect(cronDe(FILAS.entenderMarca)).toBe("30 1 * * *");
    expect(cronDe(FILAS.pesquisaDeSetor)).toBe("0 2 1 * *");
  });

  /** E26 4c: a faxina das versoes e leve (so apaga linhas), roda depois dos jobs pesados da madrugada e antes do e-mail das 08:00. */
  it("renovarContasLigadas roda todo dia as 06:20", () => {
    expect(cronDe(FILAS.renovarContasLigadas)).toBe("20 6 * * *");
  });

  it("faxinaVersoes roda todo dia as 07:15", () => {
    expect(cronDe(FILAS.faxinaVersoes)).toBe("15 7 * * *");
  });

  it("cada fila e chave aparecem no maximo uma vez", () => {
    const chaves = AGENDAMENTOS.map((a) => `${a.fila}::${a.chave ?? ""}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("metaContas roda as 03:35, depois da coleta do apify (03:30), e o contas-base roda uma hora antes (02:35): o limite do aplicativo na Meta e por hora", () => {
    expect(cronDe(FILAS.coletaApify)).toBe("30 3 * * *");
    expect(cronDe(FILAS.metaContas)).toBe("35 3 * * *");
    expect(cronDe(FILAS.contasBase)).toBe("35 2 * * *");
  });

  it("metaHashtags roda todo dia as 02:10, antes de contas-base (02:35) e meta-contas (03:35): o limite do aplicativo e por hora e ela nao rodava desde 05/10 (recent_media e janela de 24h)", () => {
    expect(cronDe(FILAS.metaHashtags)).toBe("10 2 * * *");
    // Depois do despachante das marcas (01:30) e antes das duas rotinas que gastam o limite do aplicativo.
    expect(cronDe(FILAS.contasBase)).toBe("35 2 * * *");
    expect(cronDe(FILAS.metaContas)).toBe("35 3 * * *");
    expect(cronDe(FILAS.entenderMarca)).toBe("30 1 * * *");
  });

  /** Passo 6 do estudo de 23/10/2026: buscava 0 termos desde 29/09 (teto diario do Apify gasto antes das 04:15). */
  it("a descoberta de conta do Instagram pelo Apify saiu do agendador, e o cron antigo e desinscrito", () => {
    expect(AGENDAMENTOS.some((a) => a.fila === FILAS.descobertaInstagram)).toBe(false);
    expect(listarAgendamentos()).not.toContain(FILAS.descobertaInstagram);
    expect(AGENDAMENTOS_APOSENTADOS.map((a) => a.fila)).toContain(FILAS.descobertaInstagram);
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

describe("agendarTudo", () => {
  afterEach(() => {
    config.coleta.metaAtivo = false;
  });

  it("desinscreve os crons aposentados e nao inscreve a descoberta do Instagram", async () => {
    config.coleta.metaAtivo = true;
    const schedule = vi.fn().mockResolvedValue(undefined);
    const unschedule = vi.fn().mockResolvedValue(undefined);
    vi.mocked(boss).mockReturnValue({ schedule, unschedule } as unknown as ReturnType<typeof boss>);

    await agendarTudo();

    expect(unschedule).toHaveBeenCalledWith(FILAS.descobertaInstagram, undefined);
    expect(schedule.mock.calls.map((c) => c[0])).not.toContain(FILAS.descobertaInstagram);
    expect(schedule.mock.calls.map((c) => c[0])).toContain(FILAS.metaHashtags);
  });

  it("um erro ao desinscrever nao derruba a subida do worker", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    const unschedule = vi.fn().mockRejectedValue(new Error("banco fora"));
    vi.mocked(boss).mockReturnValue({ schedule, unschedule } as unknown as ReturnType<typeof boss>);
    await expect(agendarTudo()).resolves.toBeUndefined();
    expect(schedule).toHaveBeenCalled();
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
