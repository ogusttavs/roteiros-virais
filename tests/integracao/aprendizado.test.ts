/**
 * `src/servicos/aprendizado.ts` (E27, parte 2, itens 4 e 5): consulta e as
 * duas ações do cliente ("Não é bem assim" e "Desfazer"), contra o Postgres
 * real. `rodarAprenderCliente` (o job que escreve as regras a partir das
 * reprovações) já tem o próprio teste, `tests/integracao/
 * aprender-cliente.test.ts`; este arquivo cobre o resto do serviço:
 * `regrasDoCliente` (ativas e desativadas juntas, Briefing e admin) e
 * `reativarRegra`.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { aprendizadoCliente, clientes, nichos, user } from "@/db/schema";
import {
  desativarRegra,
  ErroAprendizado,
  reativarRegra,
  regrasDoCliente,
} from "@/servicos/aprendizado";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;
let contador = 0;

async function criarCliente(): Promise<number> {
  contador += 1;
  const usuarioId = `aprendizado-teste-${contador}`;
  await db()
    .insert(user)
    .values({ id: usuarioId, name: `[teste] cliente ${contador}`, email: `${usuarioId}@aprendizado.teste` });
  const [cliente] = await db().insert(clientes).values({ usuarioId, nome: `[teste] cliente ${contador}`, nichoId }).returning();
  return cliente.id;
}

async function criarRegra(clienteId: number, regra: string, opcoes?: { ativa?: boolean }): Promise<number> {
  const [linha] = await db()
    .insert(aprendizadoCliente)
    .values({ clienteId, regra, ativa: opcoes?.ativa ?? true })
    .returning({ id: aprendizadoCliente.id });
  return linha.id;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "aprendizado-teste", nome: "Aprendizado teste", termos: [] }).returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(aprendizadoCliente);
});

describe("regrasDoCliente", () => {
  it("devolve ativas e desativadas juntas, ativas primeiro (Briefing e admin do cliente)", async () => {
    const clienteId = await criarCliente();
    await criarRegra(clienteId, "regra ativa");
    await criarRegra(clienteId, "regra desativada", { ativa: false });

    const regras = await regrasDoCliente(clienteId);
    expect(regras).toHaveLength(2);
    expect(regras[0]).toMatchObject({ regra: "regra ativa", ativa: true });
    expect(regras[1]).toMatchObject({ regra: "regra desativada", ativa: false });
  });

  it("nunca mistura cliente (item 6: circula padrão, nunca conteúdo)", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    await criarRegra(clienteA, "regra do cliente a");
    await criarRegra(clienteB, "regra do cliente b");

    const regrasA = await regrasDoCliente(clienteA);
    const regrasB = await regrasDoCliente(clienteB);

    expect(regrasA.map((r) => r.regra)).toEqual(["regra do cliente a"]);
    expect(regrasB.map((r) => r.regra)).toEqual(["regra do cliente b"]);
  });

  it("cliente sem nenhuma regra devolve lista vazia (estado semAprendizado)", async () => {
    const clienteId = await criarCliente();
    expect(await regrasDoCliente(clienteId)).toEqual([]);
  });
});

describe("reativarRegra (\"Desfazer\")", () => {
  it("reativa uma regra desativada, limpando desativada_em", async () => {
    const clienteId = await criarCliente();
    const regraId = await criarRegra(clienteId, "regra desativada", { ativa: false });

    await reativarRegra(clienteId, regraId);

    const [linha] = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.id, regraId));
    expect(linha.ativa).toBe(true);
    expect(linha.desativadaEm).toBeNull();
  });
});

describe("isolamento entre clientes nas ações (\"Não é bem assim\" e \"Desfazer\")", () => {
  it("desativarRegra recusa mexer numa regra de outro cliente", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const regraDoA = await criarRegra(clienteA, "regra do cliente a");

    await expect(desativarRegra(clienteB, regraDoA)).rejects.toThrow(ErroAprendizado);

    const [linha] = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.id, regraDoA));
    expect(linha.ativa).toBe(true); // continua ativa, o cliente B nao conseguiu mexer
  });

  it("reativarRegra recusa mexer numa regra de outro cliente", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const regraDoA = await criarRegra(clienteA, "regra do cliente a", { ativa: false });

    await expect(reativarRegra(clienteB, regraDoA)).rejects.toThrow(ErroAprendizado);

    const [linha] = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.id, regraDoA));
    expect(linha.ativa).toBe(false); // continua desativada
  });
});
