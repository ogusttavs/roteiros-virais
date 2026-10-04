/**
 * A Server Action de entrada do "ver como" (E46 PR 2, regra 1): quem não é admin, ou não tem sessão, é recusado antes de qualquer leitura ou gravação, e nada entra em
 * `ver_como_entradas`; para o admin, uma pessoa que não é da conta volta como recusa (nunca como erro de servidor).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { clientes, membrosMarca, nichos, user, verComoEntradas } from "@/db/schema";
import { ErroAcessoNegado } from "@/servicos/clientes";

import { resetarSchema } from "../../scripts/resetar-schema";

const estado = vi.hoisted(() => ({ sessao: null as null | { user: { id: string; role: string } } }));

vi.mock("@/lib/sessao", () => ({ sessaoAtual: async () => estado.sessao, exigirAdmin: async () => estado.sessao }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));

const { entrarVerComoAction } = await import("@/app/admin/clientes/[id]/acoes");

let marca: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "ver-como-acao", nome: "Ver como ação", termos: [] }).returning();
  await db().insert(user).values([
    { id: "va-admin", name: "Admin", email: "va-admin@exemplo.teste", role: "admin" },
    { id: "va-pessoa", name: "Pessoa", email: "va-pessoa@exemplo.teste", role: "cliente" },
    { id: "va-fora", name: "Fora", email: "va-fora@exemplo.teste", role: "cliente" },
  ]);
  const [c] = await db().insert(clientes).values({ usuarioId: "va-pessoa", nome: "Marca", nichoId: nicho.id }).returning();
  marca = c.id;
  await db().insert(membrosMarca).values({ usuarioId: "va-pessoa", clienteId: marca, papel: "dono" });
}, 30_000);

beforeEach(() => {
  estado.sessao = null;
});

afterAll(async () => {
  await getPool().end();
});

async function totalDeEntradas() {
  return (await db().select().from(verComoEntradas)).length;
}

describe("entrarVerComoAction", () => {
  it("sem sessão ou com sessão de cliente, recusa e não registra nada", async () => {
    await expect(entrarVerComoAction(marca, "va-pessoa")).rejects.toBeInstanceOf(ErroAcessoNegado);
    estado.sessao = { user: { id: "va-pessoa", role: "cliente" } };
    await expect(entrarVerComoAction(marca, "va-pessoa")).rejects.toBeInstanceOf(ErroAcessoNegado);
    estado.sessao = { user: { id: "va-pessoa", role: "admin-de-mentira" } };
    await expect(entrarVerComoAction(marca, "va-pessoa")).rejects.toBeInstanceOf(ErroAcessoNegado);
    expect(await totalDeEntradas()).toBe(0);
  });

  it("para o admin, pessoa de fora da conta volta como recusa e não registra nada; a certa registra e redireciona ao painel", async () => {
    estado.sessao = { user: { id: "va-admin", role: "admin" } };
    const recusa = await entrarVerComoAction(marca, "va-fora");
    expect(recusa.ok).toBe(false);
    expect(await totalDeEntradas()).toBe(0);
    await expect(entrarVerComoAction(marca, "va-pessoa")).rejects.toThrow("REDIRECT:/hoje");
    expect(await totalDeEntradas()).toBe(1);
  });
});
