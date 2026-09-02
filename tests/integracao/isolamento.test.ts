/**
 * Dado de um cliente nunca aparece para outro (plataforma/CLAUDE.md;
 * plano de execucao, etapa 3, criterio de aceite). garantirClientePermitido
 * e a funcao que /api/clientes/[id] usa para decidir o 403.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, user } from "@/db/schema";
import { ErroAcessoNegado, garantirClientePermitido } from "@/servicos/clientes";

import { resetarSchema } from "../../scripts/resetar-schema";

let clienteA: { id: number };
let clienteB: { id: number };

beforeAll(async () => {
  await resetarSchema(db());

  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "isolamento-teste", nome: "Isolamento teste" })
    .returning();

  await db()
    .insert(user)
    .values([
      { id: "isolamento-a", name: "[teste] Cliente A", email: "a@isolamento.teste" },
      { id: "isolamento-b", name: "[teste] Cliente B", email: "b@isolamento.teste" },
    ]);

  [clienteA] = await db()
    .insert(clientes)
    .values({ usuarioId: "isolamento-a", nome: "[teste] Cliente A", nichoId: nicho.id })
    .returning();
  [clienteB] = await db()
    .insert(clientes)
    .values({ usuarioId: "isolamento-b", nome: "[teste] Cliente B", nichoId: nicho.id })
    .returning();
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("isolamento entre clientes", () => {
  it("cliente acessa o proprio recurso", async () => {
    const cliente = await garantirClientePermitido(clienteA.id, "isolamento-a");
    expect(cliente.id).toBe(clienteA.id);
  });

  it("cliente nao acessa recurso de outro cliente", async () => {
    await expect(garantirClientePermitido(clienteB.id, "isolamento-a")).rejects.toThrow(
      ErroAcessoNegado,
    );
  });

  it("usuario sem cliente nao acessa recurso nenhum", async () => {
    await expect(garantirClientePermitido(clienteA.id, "usuario-inexistente")).rejects.toThrow(
      ErroAcessoNegado,
    );
  });
});
