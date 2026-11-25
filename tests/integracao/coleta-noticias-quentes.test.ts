/**
 * A coleta quente (25/11/2026): só lê ramo em uso, devolve o resumo de peso e nunca roda duas ao mesmo tempo; a chave desligada não agenda nada.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { nichos } from "@/db/schema";
import { AGENDAMENTOS, agendarTudo } from "@/jobs/agenda";
import { rodarColetaNoticiasQuentes } from "@/jobs/coleta-noticias-quentes";
import { boss, FILAS } from "@/jobs/fila";

import { resetarSchema } from "../../scripts/resetar-schema";

vi.mock("@/jobs/fila", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/jobs/fila")>()), boss: vi.fn() }));

let ramoEmUso: number;
let ramoParado: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [a] = await db().insert(nichos).values({ slug: "quente-em-uso", nome: "Em uso", termos: ["a"] }).returning();
  const [b] = await db().insert(nichos).values({ slug: "quente-parado", nome: "Parado", termos: ["b"] }).returning();
  ramoEmUso = a.id;
  ramoParado = b.id;
}, 30_000);

afterEach(() => {
  delete process.env.NOTICIAS_QUENTES_ATIVO;
});

afterAll(async () => {
  vi.restoreAllMocks();
});

const semRede = { baixar: async () => { throw new Error("sem rede"); }, buscarPagina: async () => null };

describe("rodarColetaNoticiasQuentes", () => {
  it("lê só o ramo em uso e diz quantos feeds leu, quantas notícias novas e quanto levou", async () => {
    const lidos: number[] = [];
    const resumo = await rodarColetaNoticiasQuentes({
      ...semRede,
      ramosEmUso: async () => [ramoEmUso],
      coletarRamo: async (id) => {
        lidos.push(id);
        return { termosBuscados: 3 };
      },
    });
    expect(lidos).toEqual([ramoEmUso]);
    expect(lidos).not.toContain(ramoParado);
    expect(resumo.ramos).toBe(1);
    expect(resumo.buscasDeRamo).toBe(3);
    expect(resumo.noticiasNovas).toBe(0);
    expect(typeof resumo.duracaoMs).toBe("number");
    expect(resumo.feedsLidos).toBeGreaterThanOrEqual(3);
  });

  it("sem ramo em uso, não faz nada", async () => {
    const coletarRamo = vi.fn();
    const resumo = await rodarColetaNoticiasQuentes({ ...semRede, ramosEmUso: async () => [], coletarRamo });
    expect(coletarRamo).not.toHaveBeenCalled();
    expect(resumo.ramos).toBe(0);
  });

  it("uma segunda rodada enquanto a primeira anda é pulada", async () => {
    let solta!: () => void;
    const trava = new Promise<void>((r) => (solta = r));
    const primeira = rodarColetaNoticiasQuentes({ ...semRede, ramosEmUso: async () => [ramoEmUso], coletarRamo: async () => (await trava, { termosBuscados: 1 }) });
    await new Promise((r) => setTimeout(r, 50));
    const segunda = await rodarColetaNoticiasQuentes({ ...semRede, ramosEmUso: async () => [ramoEmUso], coletarRamo: async () => ({}) });
    expect(segunda.pulada).toBe(true);
    solta();
    await primeira;
  });
});

describe("agendamento da coleta quente", () => {
  it("o cron é de 2 em 2 horas, das 08:00 às 20:00, com singleton", () => {
    const a = AGENDAMENTOS.find((x) => x.fila === FILAS.coletaNoticiasQuentes);
    expect(a?.cron).toBe("0 8-20/2 * * *");
    expect(a?.opcoes?.singletonKey).toBeTruthy();
  });

  it("desligada (padrão), não agenda nada; ligada, agenda", async () => {
    const schedule = vi.fn(async () => undefined);
    vi.mocked(boss).mockReturnValue({ schedule, unschedule: vi.fn() } as never);
    await agendarTudo();
    expect(schedule.mock.calls.some((c) => (c as unknown[])[0] === FILAS.coletaNoticiasQuentes)).toBe(false);
    schedule.mockClear();
    process.env.NOTICIAS_QUENTES_ATIVO = "1";
    await agendarTudo();
    expect(schedule.mock.calls.filter((c) => (c as unknown[])[0] === FILAS.coletaNoticiasQuentes)).toHaveLength(1);
  });
});
