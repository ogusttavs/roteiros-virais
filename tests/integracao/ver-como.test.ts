/**
 * O registro do "ver como" (E46 PR 2) contra o Postgres real: só admin entra, só em pessoa membro de conta ativa e que não é admin; entrar de novo fecha a anterior como `trocou`; saída e
 * expiração ficam registradas; as pessoas visíveis e as últimas entradas.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, membrosMarca, nichos, user, verComoEntradas } from "@/db/schema";
import { DURACAO_VER_COMO_MS } from "@/lib/ver-como-cookie";
import { entradaAberta, ErroVerComo, pessoaDaConta, pessoasVisiveis, registrarEntradaVerComo, registrarSaidaVerComo, ultimasEntradasVerComo } from "@/servicos/ver-como";

import { resetarSchema } from "../../scripts/resetar-schema";

let marcaA: number;
let marcaB: number;
let marcaInativa: number;

async function usuario(id: string, role: string | null) {
  await db().insert(user).values({ id, name: `Nome ${id}`, email: `${id}@exemplo.teste`, role });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "ver-como", nome: "Ver como", termos: [] }).returning();
  await usuario("vc-admin", "admin");
  await usuario("vc-admin2", "admin");
  await usuario("vc-dono", "cliente");
  await usuario("vc-membro", null);
  await usuario("vc-fora", "cliente");
  const [a] = await db().insert(clientes).values({ usuarioId: "vc-dono", nome: "Marca A", nichoId: nicho.id }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "vc-fora", nome: "Marca B", nichoId: nicho.id }).returning();
  const [c] = await db().insert(clientes).values({ usuarioId: "vc-dono", nome: "Marca C", nichoId: nicho.id, ativo: false }).returning();
  marcaA = a.id;
  marcaB = b.id;
  marcaInativa = c.id;
  await db().insert(membrosMarca).values([
    { usuarioId: "vc-dono", clienteId: marcaA, papel: "dono" },
    { usuarioId: "vc-membro", clienteId: marcaA, papel: "membro" },
    { usuarioId: "vc-admin2", clienteId: marcaA, papel: "membro" },
    { usuarioId: "vc-fora", clienteId: marcaB, papel: "dono" },
    { usuarioId: "vc-dono", clienteId: marcaInativa, papel: "dono" },
  ]);
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("registrarEntradaVerComo", () => {
  it("o admin entra numa pessoa da conta, e a expiração é 30 minutos depois", async () => {
    const agora = new Date("2026-10-05T10:00:00Z");
    const entrada = await registrarEntradaVerComo("vc-admin", marcaA, "vc-dono", agora);
    expect(entrada.adminId).toBe("vc-admin");
    expect(entrada.pessoaId).toBe("vc-dono");
    expect(entrada.expiraEm.getTime() - entrada.entrouEm.getTime()).toBe(DURACAO_VER_COMO_MS);
    expect(entrada.saiuEm).toBeNull();
    expect(await entradaAberta(entrada.id)).not.toBeNull();
  });

  it("quem não é admin nunca entra (regra 1), nem pessoa de outra conta, nem admin visto, nem conta desativada", async () => {
    await expect(registrarEntradaVerComo("vc-dono", marcaA, "vc-membro")).rejects.toBeInstanceOf(ErroVerComo);
    await expect(registrarEntradaVerComo("vc-membro", marcaA, "vc-dono")).rejects.toBeInstanceOf(ErroVerComo);
    await expect(registrarEntradaVerComo("vc-admin", marcaA, "vc-fora")).rejects.toBeInstanceOf(ErroVerComo);
    await expect(registrarEntradaVerComo("vc-admin", marcaA, "vc-admin2")).rejects.toBeInstanceOf(ErroVerComo);
    await expect(registrarEntradaVerComo("vc-admin", marcaInativa, "vc-dono")).rejects.toBeInstanceOf(ErroVerComo);
    await expect(registrarEntradaVerComo("id-que-nao-existe", marcaA, "vc-dono")).rejects.toBeInstanceOf(ErroVerComo);
  });

  it("entrar de novo fecha a anterior do mesmo admin como 'trocou'", async () => {
    const primeira = await registrarEntradaVerComo("vc-admin", marcaA, "vc-membro");
    const segunda = await registrarEntradaVerComo("vc-admin", marcaA, "vc-dono");
    expect(await entradaAberta(primeira.id)).toBeNull();
    expect(await entradaAberta(segunda.id)).not.toBeNull();
    const [fechada] = await db().select().from(verComoEntradas).where(eq(verComoEntradas.id, primeira.id));
    expect(fechada.motivoSaida).toBe("trocou");
    expect(fechada.saiuEm).not.toBeNull();
  });

  it("a entrada anterior que já passou da hora fecha como 'expirou', não como 'trocou'", async () => {
    const antiga = await registrarEntradaVerComo("vc-admin", marcaA, "vc-membro", new Date(Date.now() - 2 * DURACAO_VER_COMO_MS));
    await registrarEntradaVerComo("vc-admin", marcaA, "vc-dono");
    const [fechada] = await db().select().from(verComoEntradas).where(eq(verComoEntradas.id, antiga.id));
    expect(fechada.motivoSaida).toBe("expirou");
  });

  it("a saída fica registrada, e fechar duas vezes não muda o primeiro motivo", async () => {
    const entrada = await registrarEntradaVerComo("vc-admin", marcaA, "vc-membro");
    await registrarSaidaVerComo(entrada.id, "saiu");
    await registrarSaidaVerComo(entrada.id, "expirou");
    const [linha] = await db().select().from(verComoEntradas).where(eq(verComoEntradas.id, entrada.id));
    expect(linha.motivoSaida).toBe("saiu");
    expect(await entradaAberta(entrada.id)).toBeNull();
  });
});

describe("a leitura", () => {
  it("pessoaDaConta: membro de conta ativa e não admin; role nulo conta como pessoa", async () => {
    expect((await pessoaDaConta("vc-membro", marcaA))?.usuario.id).toBe("vc-membro");
    expect(await pessoaDaConta("vc-admin2", marcaA)).toBeNull();
    expect(await pessoaDaConta("vc-fora", marcaA)).toBeNull();
    expect(await pessoaDaConta("vc-dono", marcaInativa)).toBeNull();
  });

  it("pessoasVisiveis tira os admins; ultimasEntradas lista da mais nova para a mais antiga, só da conta", async () => {
    expect((await pessoasVisiveis(marcaA)).map((p) => p.usuarioId).sort()).toEqual(["vc-dono", "vc-membro"]);
    const entradas = await ultimasEntradasVerComo(marcaA);
    expect(entradas.length).toBeGreaterThanOrEqual(3);
    expect(entradas[0].entrouEm.getTime()).toBeGreaterThanOrEqual(entradas[entradas.length - 1].entrouEm.getTime());
    expect(await ultimasEntradasVerComo(marcaB)).toEqual([]);
  });
});
