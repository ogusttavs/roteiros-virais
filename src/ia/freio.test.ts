/**
 * O freio de gasto da IA por marca (achado A4 da auditoria de 26/11/2026), na parte que não precisa de banco: a decisão de cada janela, a fila das chamadas ao mesmo tempo, a falha ao
 * ler o gasto (a chamada passa) e os limites lidos do ambiente. O caminho inteiro, com o Postgres e o relógio simulado, está em `tests/integracao/freio-de-gasto.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { limitesDoFreioDaIA, PADROES_DO_FREIO_DA_IA } from "@/lib/config";

import { comFreioDeGasto, decidirFreio, vagasDaMarca } from "./freio";

vi.mock("@/db", () => ({
  db: () => {
    throw new Error("sem banco neste teste");
  },
}));
vi.mock("@/servicos/aviso-da-ia", () => ({ avisarFreioDeGasto: vi.fn() }));

const LIMITES = { porHoraUsd: 8, porDiaUsd: 25 };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("decidirFreio", () => {
  it("deixa passar abaixo dos dois limites", () => {
    expect(decidirFreio({ hora: 7.99, dia: 24.99, semTetoDoDia: false }, LIMITES)).toBeNull();
  });

  it("freia pela hora ao chegar no limite, com o gasto e o limite", () => {
    expect(decidirFreio({ hora: 8, dia: 8, semTetoDoDia: false }, LIMITES)).toEqual({ janela: "hora", gastoUsd: 8, limiteUsd: 8 });
  });

  it("a hora vale também para a cortesia e o plano sem limite (proteção contra abuso, não regra de plano)", () => {
    expect(decidirFreio({ hora: 9, dia: 9, semTetoDoDia: true }, LIMITES)).toEqual({ janela: "hora", gastoUsd: 9, limiteUsd: 8 });
  });

  it("freia pelo dia a marca comum, e não a de cortesia ou sem limite", () => {
    expect(decidirFreio({ hora: 1, dia: 25, semTetoDoDia: false }, LIMITES)).toEqual({ janela: "dia", gastoUsd: 25, limiteUsd: 25 });
    expect(decidirFreio({ hora: 1, dia: 300, semTetoDoDia: true }, LIMITES)).toBeNull();
  });

  it("com as duas janelas acima, diz a hora (a que volta mais cedo)", () => {
    expect(decidirFreio({ hora: 10, dia: 30, semTetoDoDia: false }, LIMITES)?.janela).toBe("hora");
  });
});

describe("limitesDoFreioDaIA", () => {
  it("sem nada no ambiente, os padrões e o freio ligado", () => {
    vi.stubEnv("FREIO_IA", "");
    vi.stubEnv("FREIO_IA_POR_HORA_USD", "");
    vi.stubEnv("FREIO_IA_POR_DIA_USD", "");
    vi.stubEnv("FREIO_IA_SIMULTANEAS", "");
    expect(limitesDoFreioDaIA()).toEqual({ ativo: true, ...PADROES_DO_FREIO_DA_IA });
  });

  it("FREIO_IA=0 desliga; valores do ambiente valem; zero, negativo ou texto voltam ao padrão", () => {
    vi.stubEnv("FREIO_IA", "0");
    vi.stubEnv("FREIO_IA_POR_HORA_USD", "12.5");
    vi.stubEnv("FREIO_IA_POR_DIA_USD", "0");
    vi.stubEnv("FREIO_IA_SIMULTANEAS", "abc");
    expect(limitesDoFreioDaIA()).toEqual({ ativo: false, porHoraUsd: 12.5, porDiaUsd: PADROES_DO_FREIO_DA_IA.porDiaUsd, simultaneas: PADROES_DO_FREIO_DA_IA.simultaneas });
    vi.stubEnv("FREIO_IA_POR_HORA_USD", "-3");
    vi.stubEnv("FREIO_IA_SIMULTANEAS", "2.7");
    expect(limitesDoFreioDaIA()).toMatchObject({ porHoraUsd: PADROES_DO_FREIO_DA_IA.porHoraUsd, simultaneas: 2 });
  });
});

describe("comFreioDeGasto", () => {
  it("sem marca, chama direto, sem ler gasto nem ocupar vaga", async () => {
    await expect(comFreioDeGasto(undefined, "roteiro", async () => "ok")).resolves.toBe("ok");
  });

  it("se a leitura do gasto cair, a chamada passa (o freio nunca derruba a IA de todo mundo)", async () => {
    await expect(comFreioDeGasto(41, "roteiro", async () => "passou")).resolves.toBe("passou");
    expect(vagasDaMarca(41)).toEqual({ ocupadas: 0, esperando: 0 });
  });

  it("com o limite de 2 ao mesmo tempo, a terceira chamada da marca espera a vez, outra marca não espera, e a vaga volta mesmo com erro", async () => {
    vi.stubEnv("FREIO_IA_SIMULTANEAS", "2");
    const soltar: Array<() => void> = [];
    const comecou: number[] = [];
    const chamada = (n: number, falhar = false) =>
      comFreioDeGasto(42, "roteiro", () => {
        comecou.push(n);
        return new Promise<number>((ok, erro) => soltar.push(() => (falhar ? erro(new Error(`falhou ${n}`)) : ok(n))));
      });

    const primeira = chamada(1, true);
    const segunda = chamada(2);
    const terceira = chamada(3);
    const deOutraMarca = comFreioDeGasto(43, "roteiro", async () => "outra");
    await vi.waitFor(() => expect(comecou).toEqual([1, 2]));
    expect(vagasDaMarca(42)).toEqual({ ocupadas: 2, esperando: 1 });
    await expect(deOutraMarca).resolves.toBe("outra");

    soltar[0]();
    await expect(primeira).rejects.toThrow("falhou 1");
    await vi.waitFor(() => expect(comecou).toEqual([1, 2, 3]));
    expect(vagasDaMarca(42)).toEqual({ ocupadas: 2, esperando: 0 });

    soltar[1]();
    soltar[2]();
    await expect(Promise.all([segunda, terceira])).resolves.toEqual([2, 3]);
    expect(vagasDaMarca(42)).toEqual({ ocupadas: 0, esperando: 0 });
  });

  it("com o freio desligado, nem a fila vale", async () => {
    vi.stubEnv("FREIO_IA", "0");
    vi.stubEnv("FREIO_IA_SIMULTANEAS", "1");
    const soltar: Array<() => void> = [];
    const chamadas = [1, 2].map((n) => comFreioDeGasto(44, "roteiro", () => new Promise<number>((ok) => soltar.push(() => ok(n)))));
    await vi.waitFor(() => expect(soltar).toHaveLength(2));
    soltar.forEach((s) => s());
    await expect(Promise.all(chamadas)).resolves.toEqual([1, 2]);
  });
});
