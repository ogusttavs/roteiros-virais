/**
 * Regra 7 do "ver como" (E46 PR 2) contra o Postgres real: no modo, a conta ativa é a do cookie (conferida no banco), nunca a que o `marca_ativa` do navegador do admin escolheria,
 * e uma pessoa que não é membro da conta do modo não abre nada. Fora do modo, nada muda.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { clientes, membrosMarca, nichos, user } from "@/db/schema";
import { clienteAtivoDoUsuario, ErroAcessoNegado } from "@/servicos/clientes";

import { resetarSchema } from "../../scripts/resetar-schema";

const estado = vi.hoisted(() => ({ ativo: null as null | { pessoaId: string; clienteId: number } }));

vi.mock("@/lib/ver-como", () => ({
  sessaoDoPainel: async () => null,
  lerEstadoVerComo: async () =>
    estado.ativo ? { estado: "ativo", modo: { pessoa: { id: estado.ativo.pessoaId }, clienteId: estado.ativo.clienteId } } : { estado: "inativo" },
}));

let primeira: number;
let segunda: number;
let alheia: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "ver-como-modo", nome: "Ver como modo", termos: [] }).returning();
  for (const id of ["vm-pessoa", "vm-outra"]) await db().insert(user).values({ id, name: id, email: `${id}@exemplo.teste`, role: "cliente" });
  const [a] = await db().insert(clientes).values({ usuarioId: "vm-pessoa", nome: "A primeira", nichoId: nicho.id }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "vm-pessoa", nome: "B segunda", nichoId: nicho.id }).returning();
  const [c] = await db().insert(clientes).values({ usuarioId: "vm-outra", nome: "C alheia", nichoId: nicho.id }).returning();
  primeira = a.id;
  segunda = b.id;
  alheia = c.id;
  await db().insert(membrosMarca).values([
    { usuarioId: "vm-pessoa", clienteId: primeira, papel: "dono" },
    { usuarioId: "vm-pessoa", clienteId: segunda, papel: "dono" },
    { usuarioId: "vm-outra", clienteId: alheia, papel: "dono" },
  ]);
}, 30_000);

beforeEach(() => {
  estado.ativo = null;
});

afterAll(async () => {
  await getPool().end();
});

describe("clienteAtivoDoUsuario no ver como", () => {
  it("fora do modo, resolve como sempre (uma das marcas da pessoa)", async () => {
    const marca = await clienteAtivoDoUsuario("vm-pessoa");
    expect([primeira, segunda]).toContain(marca?.id);
  });

  it("no modo, devolve a conta do cookie, qualquer que seja a padrão da pessoa", async () => {
    estado.ativo = { pessoaId: "vm-pessoa", clienteId: segunda };
    expect((await clienteAtivoDoUsuario("vm-pessoa"))?.id).toBe(segunda);
    estado.ativo = { pessoaId: "vm-pessoa", clienteId: primeira };
    expect((await clienteAtivoDoUsuario("vm-pessoa"))?.id).toBe(primeira);
  });

  it("no modo, uma conta de que a pessoa não é membro nunca abre", async () => {
    estado.ativo = { pessoaId: "vm-pessoa", clienteId: alheia };
    await expect(clienteAtivoDoUsuario("vm-pessoa")).rejects.toBeInstanceOf(ErroAcessoNegado);
  });

  it("o modo de uma pessoa não vale para outra", async () => {
    estado.ativo = { pessoaId: "vm-pessoa", clienteId: segunda };
    expect((await clienteAtivoDoUsuario("vm-outra"))?.id).toBe(alheia);
  });
});
