/**
 * `lotePendenteHaHoras` (M1, item 3): achado em produção em 30/09/2026, o lote de análise ficou
 * mais de três horas parado no provedor (19 a 80 minutos nos outros dias) e ninguém via isso até
 * o painel de Referências chegar vazio na manhã seguinte. Arquivo próprio: a consulta olha
 * `lotes_ia` inteira, sem filtro de nicho.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { lotesIa } from "@/db/schema";
import { lotePendenteHaHoras } from "@/servicos/admin-acompanhamento";

import { resetarSchema } from "../../scripts/resetar-schema";

const HORA_MS = 60 * 60 * 1000;

async function criarLote(status: "em_andamento" | "concluido" | "erro", criadoEm: Date, loteIdExterno: string) {
  await db()
    .insert(lotesIa)
    .values({ tarefa: "extrairVideo", loteIdExterno, status, criadoEm });
}

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(lotesIa);
});

describe("lotePendenteHaHoras", () => {
  it("sem lote nenhum: null", async () => {
    expect(await lotePendenteHaHoras()).toBeNull();
  });

  it("lote pendente ha menos de 2 horas: dentro do normal, null", async () => {
    await criarLote("em_andamento", new Date(Date.now() - HORA_MS), "lote-recente");
    expect(await lotePendenteHaHoras()).toBeNull();
  });

  it("lote pendente ha mais de 2 horas: aparece, com a tarefa e as horas", async () => {
    const agora = new Date();
    await criarLote("em_andamento", new Date(agora.getTime() - 3 * HORA_MS), "lote-atrasado");

    const resultado = await lotePendenteHaHoras(agora);
    expect(resultado).toEqual({ tarefa: "extrairVideo", horasPendente: 3 });
  });

  it("lote concluido nao conta, mesmo antigo", async () => {
    await criarLote("concluido", new Date(Date.now() - 10 * HORA_MS), "lote-concluido");
    expect(await lotePendenteHaHoras()).toBeNull();
  });

  it("mais de um lote pendente: usa o mais antigo", async () => {
    const agora = new Date();
    await criarLote("em_andamento", new Date(agora.getTime() - 2 * HORA_MS), "lote-mais-novo");
    await criarLote("em_andamento", new Date(agora.getTime() - 5 * HORA_MS), "lote-mais-velho");

    const resultado = await lotePendenteHaHoras(agora);
    expect(resultado?.horasPendente).toBe(5);

    // conferindo que e mesmo o mais antigo que fica pendente na tabela.
    const [linha] = await db().select().from(lotesIa).where(eq(lotesIa.loteIdExterno, "lote-mais-velho"));
    expect(linha.status).toBe("em_andamento");
  });
});
