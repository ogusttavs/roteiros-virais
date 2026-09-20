/**
 * Dado de um cliente nunca aparece para outro (plataforma/CLAUDE.md;
 * plano de execucao, etapa 3, criterio de aceite). garantirClientePermitido
 * e a funcao que /api/clientes/[id] usa para decidir o 403.
 *
 * V3, item 2: com varias marcas por usuario, o mock de `next/headers`
 * abaixo (`cookieJar`, um Map controlado pelo proprio teste) permite forjar
 * o cookie `marca_ativa` e provar que ele nunca concede pertencimento a
 * marca nenhuma, so escolhe entre as que a consulta ao banco ja provou que
 * sao do usuario.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nome: string) => (cookieJar.has(nome) ? { name: nome, value: cookieJar.get(nome)! } : undefined),
    set: (nome: string, valor: string) => {
      cookieJar.set(nome, valor);
    },
  }),
}));

import { db, getPool } from "@/db";
import { clientes, membrosMarca, nichos, roteiros, user } from "@/db/schema";
import { valorCookieMarcaAtiva } from "@/lib/marca-ativa";
import {
  clienteAtivoDoUsuario,
  ErroAcessoNegado,
  garantirClientePermitido,
  garantirMembroDaMarca,
} from "@/servicos/clientes";

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

  // V3, item 1: sem o membro "dono", garantirClientePermitido recusa todo mundo.
  await db()
    .insert(membrosMarca)
    .values([
      { usuarioId: "isolamento-a", clienteId: clienteA.id, papel: "dono" },
      { usuarioId: "isolamento-b", clienteId: clienteB.id, papel: "dono" },
    ]);
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

describe("isolamento entre marcas, com varias por usuario (V3, item 2)", () => {
  let nichoId: number;
  let marca1: { id: number };
  let marca2: { id: number };
  let marca3: { id: number };

  beforeAll(async () => {
    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "isolamento-varias-marcas-teste", nome: "Isolamento varias marcas teste" })
      .returning();
    nichoId = nicho.id;

    await db()
      .insert(user)
      .values([
        { id: "varias-marcas-a", name: "[teste] Usuario A", email: "a@varias-marcas.teste" },
        { id: "varias-marcas-b", name: "[teste] Usuario B", email: "b@varias-marcas.teste" },
      ]);

    [marca1] = await db().insert(clientes).values({ usuarioId: "varias-marcas-a", nome: "[teste] Marca 1", nichoId }).returning();
    [marca2] = await db().insert(clientes).values({ usuarioId: "varias-marcas-a", nome: "[teste] Marca 2", nichoId }).returning();
    [marca3] = await db().insert(clientes).values({ usuarioId: "varias-marcas-b", nome: "[teste] Marca 3", nichoId }).returning();

    // A e membro das marcas 1 (dono) e 2 (membro); B so da 3 (dono). Nenhum
    // dos dois e membro da marca do outro sozinho: a marca 2 e o ponto em
    // comum que o proximo describe usa para provar dado compartilhado.
    await db()
      .insert(membrosMarca)
      .values([
        { usuarioId: "varias-marcas-a", clienteId: marca1.id, papel: "dono" },
        { usuarioId: "varias-marcas-a", clienteId: marca2.id, papel: "membro" },
        { usuarioId: "varias-marcas-b", clienteId: marca3.id, papel: "dono" },
      ]);
  }, 30_000);

  it("A nunca le a marca 3, de que nao e membro", async () => {
    await expect(garantirMembroDaMarca("varias-marcas-a", marca3.id)).rejects.toThrow(ErroAcessoNegado);
  });

  it("B nunca le as marcas 1 e 2, de que nao e membro, nem com o id na mao", async () => {
    await expect(garantirMembroDaMarca("varias-marcas-b", marca1.id)).rejects.toThrow(ErroAcessoNegado);
    await expect(garantirMembroDaMarca("varias-marcas-b", marca2.id)).rejects.toThrow(ErroAcessoNegado);
  });

  it("cookie forjado para uma marca que o usuario nao e membro nunca abre essa marca: cai na de acesso mais recente", async () => {
    cookieJar.clear();
    // B forja o cookie para a marca 1 (de A, B nunca foi membro dela).
    cookieJar.set("marca_ativa", valorCookieMarcaAtiva(marca1.id));

    const marcaResolvida = await clienteAtivoDoUsuario("varias-marcas-b");

    expect(marcaResolvida?.id).toBe(marca3.id);
    expect(marcaResolvida?.id).not.toBe(marca1.id);
  });

  it("cookie valido, apontando para uma marca de que o usuario e membro, abre essa marca", async () => {
    cookieJar.clear();
    cookieJar.set("marca_ativa", valorCookieMarcaAtiva(marca2.id));

    const marcaResolvida = await clienteAtivoDoUsuario("varias-marcas-a");

    expect(marcaResolvida?.id).toBe(marca2.id);
  });

  it("roteiro gerado na marca 2 (de A) aparece para B, que tambem e membro dela", async () => {
    cookieJar.clear();

    const [roteiro] = await db()
      .insert(roteiros)
      .values({
        clienteId: marca2.id,
        data: new Date().toISOString().slice(0, 10),
        tema: "tema de teste",
        origem: "livre",
        objetivo: "engajamento",
        conteudo: {
          titulo: "titulo",
          gancho: "gancho de teste",
          corpo: "corpo de teste",
          fechamento: "fechamento",
          chamadaFinal: "chamada",
          duracaoS: 30,
          ondeGravar: "onde",
          comoEditar: { textoNaTela: [], ritmoDeCorte: "", recursos: [], audio: "", referencia: "" },
        } as never,
      })
      .returning();

    // A adiciona B como membro da marca 2 (dar acesso, item 5), e agora os
    // dois leem o mesmo roteiro, sem duplicar dado nem criar copia por pessoa.
    await db().insert(membrosMarca).values({ usuarioId: "varias-marcas-b", clienteId: marca2.id, papel: "membro" });

    const [lidoPorA] = await db()
      .select()
      .from(roteiros)
      .where(and(eq(roteiros.id, roteiro.id), eq(roteiros.clienteId, marca2.id)));
    const [lidoPorB] = await db()
      .select()
      .from(roteiros)
      .where(and(eq(roteiros.id, roteiro.id), eq(roteiros.clienteId, marca2.id)));

    expect(lidoPorA.id).toBe(roteiro.id);
    expect(lidoPorB.id).toBe(roteiro.id);
    await expect(garantirMembroDaMarca("varias-marcas-a", marca2.id)).resolves.toBeTruthy();
    await expect(garantirMembroDaMarca("varias-marcas-b", marca2.id)).resolves.toBeTruthy();
  });
});
