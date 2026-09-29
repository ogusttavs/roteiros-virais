/**
 * As Server Actions de `hoje/acoes.ts` (V12, item 3a): a sessao de verdade e
 * o isolamento por marca, mesmo padrao de `plano-acoes.test.ts`. O que
 * `salvarRedePrincipal` faz por dentro ja tem teste proprio em
 * `clientes-rede-principal.test.ts`; aqui e so a Server Action.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));

import { db, getPool } from "@/db";
import { clientes, membrosMarca, user } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado } from "@/servicos/clientes";

import { resetarSchema } from "../../scripts/resetar-schema";
import { salvarRedePrincipalAction } from "../../src/app/(painel)/(completo)/hoje/acoes";

function sessaoDe(usuarioId: string) {
  return { user: { id: usuarioId, role: "cliente" } } as never;
}

let marcaA: { id: number; usuarioId: string };
let marcaB: { id: number; usuarioId: string };

beforeAll(async () => {
  await resetarSchema(db());
  await db()
    .insert(user)
    .values([
      { id: "hoje-acoes-a", name: "[teste] Hoje acoes A", email: "a@hoje-acoes.teste" },
      { id: "hoje-acoes-b", name: "[teste] Hoje acoes B", email: "b@hoje-acoes.teste" },
    ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "hoje-acoes-a", nome: "[teste] Marca A" }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "hoje-acoes-b", nome: "[teste] Marca B" }).returning();
  await db()
    .insert(membrosMarca)
    .values([
      { usuarioId: "hoje-acoes-a", clienteId: a.id, papel: "dono" },
      { usuarioId: "hoje-acoes-b", clienteId: b.id, papel: "dono" },
    ]);
  marcaA = { id: a.id, usuarioId: a.usuarioId };
  marcaB = { id: b.id, usuarioId: b.usuarioId };
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("salvarRedePrincipalAction", () => {
  it("sem sessao, recusa", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(null);
    await expect(salvarRedePrincipalAction("instagram")).rejects.toThrow(ErroAcessoNegado);
  });

  it("grava na marca ativa da sessao, isolado da outra marca", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    await salvarRedePrincipalAction("tiktok");

    const [linhaA] = await db().select().from(clientes).where(eq(clientes.id, marcaA.id));
    expect(linhaA.redePrincipal).toBe("tiktok");

    const [linhaB] = await db().select().from(clientes).where(eq(clientes.id, marcaB.id));
    expect(linhaB.redePrincipal).toBeNull();
  });
});
