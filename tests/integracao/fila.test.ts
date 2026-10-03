/**
 * As opcoes das filas (hotfix de 01/10/2026) contra o pg-boss de verdade: job longo com 4 horas de
 * prazo e nenhuma repeticao automatica; job curto com 2 repeticoes. O caso que importa e o da
 * fila que ja existia com as opcoes antigas (producao): `garantirFilas` tem de corrigi-la, porque
 * `createQueue` sozinho nao mexe em fila existente.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boss, FILAS, garantirFilas, opcoesDaFila } from "@/jobs/fila";

beforeAll(async () => {
  await boss().start();
}, 30_000);

afterAll(async () => {
  await boss().stop({ graceful: false });
});

describe("opcoesDaFila", () => {
  it("job longo: 4 horas de prazo e nenhuma repeticao automatica", () => {
    for (const nome of [
      FILAS.transcrever,
      FILAS.pesquisaDeSetor,
      FILAS.extrairSemFala,
      FILAS.temasDoDia,
      FILAS.pontuar,
      // E38 PR 2: ler o Instagram pode esperar a janela da Meta por quase uma hora; com 15 minutos e repeticao leria o site do cliente tres vezes.
      FILAS.entenderMarca,
    ]) {
      expect(opcoesDaFila(nome)).toEqual({ retryLimit: 0, retryBackoff: false, expireInSeconds: 4 * 60 * 60 });
    }
  });

  it("job curto: 2 repeticoes com espera crescente e o prazo de 15 minutos", () => {
    for (const nome of [FILAS.lembrete, FILAS.curvaCliente, FILAS.emailAcompanhamento, FILAS.aprenderCliente]) {
      expect(opcoesDaFila(nome)).toEqual({ retryLimit: 2, retryBackoff: true, expireInSeconds: 15 * 60 });
    }
  });

  it("toda fila conhecida tem prazo de pelo menos 15 minutos e no maximo 24 horas (limite do pg-boss)", () => {
    for (const nome of Object.values(FILAS)) {
      const { expireInSeconds } = opcoesDaFila(nome);
      expect(expireInSeconds).toBeGreaterThanOrEqual(15 * 60);
      expect(expireInSeconds).toBeLessThanOrEqual(24 * 60 * 60);
    }
  });
});

describe("garantirFilas", () => {
  it("corrige uma fila que ja existia com as opcoes antigas (2 repeticoes, prazo padrao de 15 minutos)", async () => {
    const b = boss();
    await b.createQueue(FILAS.transcrever, { retryLimit: 2, retryBackoff: true });
    await b.updateQueue(FILAS.transcrever, { retryLimit: 2, retryBackoff: true, expireInSeconds: 15 * 60 });

    await garantirFilas();

    const longa = await b.getQueue(FILAS.transcrever);
    expect(longa?.retryLimit).toBe(0);
    expect(longa?.expireInSeconds).toBe(4 * 60 * 60);

    const curta = await b.getQueue(FILAS.lembrete);
    expect(curta?.retryLimit).toBe(2);
    expect(curta?.expireInSeconds).toBe(15 * 60);
  }, 60_000);

  it("pode rodar duas vezes seguidas sem erro e sem mudar o resultado", async () => {
    await garantirFilas();
    await garantirFilas();
    const fila = await boss().getQueue(FILAS.pesquisaDeSetor);
    expect(fila?.retryLimit).toBe(0);
    expect(fila?.expireInSeconds).toBe(4 * 60 * 60);
  }, 60_000);
});
