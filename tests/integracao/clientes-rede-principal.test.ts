/**
 * `salvarRedePrincipal` (V12, item 3a): a rede onde a marca mais posta,
 * perguntada uma vez na porta Reels, nula até responder, trocável depois.
 * Contra o Postgres real; a ordem que ela dá à evidência do roteiro já tem
 * teste próprio em `tests/integracao/roteiro.test.ts`.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, user } from "@/db/schema";
import { ErroCliente, salvarRedePrincipal } from "@/servicos/clientes";

import { resetarSchema } from "../../scripts/resetar-schema";

let contador = 0;

async function criarCliente() {
  contador += 1;
  const usuarioId = `rede-principal-teste-${contador}`;
  await db()
    .insert(user)
    .values({ id: usuarioId, name: `[teste] rede principal ${contador}`, email: `${usuarioId}@rede-principal.teste` });
  const [cliente] = await db().insert(clientes).values({ usuarioId, nome: `[teste] rede principal ${contador}` }).returning();
  return cliente;
}

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("salvarRedePrincipal", () => {
  it("nula ate a pessoa responder", async () => {
    const cliente = await criarCliente();
    expect(cliente.redePrincipal).toBeNull();
  });

  it("grava e a leitura seguinte devolve o valor gravado", async () => {
    const cliente = await criarCliente();

    await salvarRedePrincipal(cliente.id, "instagram");

    const [linha] = await db().select().from(clientes).where(eq(clientes.id, cliente.id));
    expect(linha.redePrincipal).toBe("instagram");
  });

  it("trocavel a qualquer hora, isolado por marca", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();

    await salvarRedePrincipal(clienteA.id, "tiktok");
    await salvarRedePrincipal(clienteA.id, "youtube");
    await salvarRedePrincipal(clienteB.id, "instagram");

    const [linhaA] = await db().select().from(clientes).where(eq(clientes.id, clienteA.id));
    const [linhaB] = await db().select().from(clientes).where(eq(clientes.id, clienteB.id));
    expect(linhaA.redePrincipal).toBe("youtube");
    expect(linhaB.redePrincipal).toBe("instagram");
  });

  it("rede fora da lista: erro nomeado, sem gravar", async () => {
    const cliente = await criarCliente();

    await expect(salvarRedePrincipal(cliente.id, "facebook")).rejects.toThrow(ErroCliente);

    const [linha] = await db().select().from(clientes).where(eq(clientes.id, cliente.id));
    expect(linha.redePrincipal).toBeNull();
  });
});
