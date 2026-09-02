/**
 * Dados fixos do briefing (briefing-e-rubricas.md, secao 1; brief-frontend.md,
 * 6.2): salvarDadosFixos grava nome, cidade, bairro, ramo (nichoId ou
 * ramoOutro, nunca os dois), persona, perfis e quem grava. listarNichosAtivos
 * alimenta a lista de ramo da tela.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, user } from "@/db/schema";
import { listarNichosAtivos, salvarDadosFixos } from "@/servicos/clientes";

import { resetarSchema } from "../../scripts/resetar-schema";

let clienteId: number;
let outroClienteId: number;
let nichoAtivoId: number;

beforeAll(async () => {
  await resetarSchema(db());

  const [nichoAtivo] = await db()
    .insert(nichos)
    .values({ slug: "dados-fixos-ativo", nome: "Dados fixos ativo" })
    .returning();
  await db().insert(nichos).values({ slug: "dados-fixos-inativo", nome: "Dados fixos inativo", ativo: false });

  await db()
    .insert(user)
    .values([
      { id: "dados-fixos-a", name: "[teste] Dados Fixos A", email: "a@dados-fixos.teste" },
      { id: "dados-fixos-b", name: "[teste] Dados Fixos B", email: "b@dados-fixos.teste" },
    ]);

  const [clienteA] = await db()
    .insert(clientes)
    .values({ usuarioId: "dados-fixos-a", nome: "[teste] Negocio A" })
    .returning();
  const [clienteB] = await db()
    .insert(clientes)
    .values({ usuarioId: "dados-fixos-b", nome: "[teste] Negocio B" })
    .returning();

  clienteId = clienteA.id;
  outroClienteId = clienteB.id;
  nichoAtivoId = nichoAtivo.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("listarNichosAtivos", () => {
  it("lista so os nichos ativos", async () => {
    const ativos = await listarNichosAtivos();
    expect(ativos.some((n) => n.id === nichoAtivoId)).toBe(true);
    expect(ativos.every((n) => n.id !== undefined)).toBe(true);
    expect(ativos.map((n) => n.nome)).not.toContain("Dados fixos inativo");
  });
});

describe("salvarDadosFixos", () => {
  it("grava nome, cidade, bairro, ramo (nichoId), persona, perfis e quem grava", async () => {
    const cliente = await salvarDadosFixos(clienteId, {
      nome: "Sorriso Novo",
      cidade: "Belo Horizonte",
      bairro: "Savassi",
      nichoId: nichoAtivoId,
      persona: "negocio",
      perfis: { instagram: "@sorrisonovo" },
      quemGrava: "propria_pessoa",
    });

    expect(cliente.nome).toBe("Sorriso Novo");
    expect(cliente.cidade).toBe("Belo Horizonte");
    expect(cliente.bairro).toBe("Savassi");
    expect(cliente.nichoId).toBe(nichoAtivoId);
    expect(cliente.ramoOutro).toBeNull();
    expect(cliente.persona).toBe("negocio");
    expect(cliente.perfis).toEqual({ instagram: "@sorrisonovo", tiktok: null, youtube: null });
    expect(cliente.quemGrava).toBe("propria_pessoa");
  });

  it("ramo por texto livre grava ramoOutro e limpa nichoId", async () => {
    const cliente = await salvarDadosFixos(clienteId, {
      nome: "Sorriso Novo",
      cidade: "Belo Horizonte",
      ramoOutro: "clinica veterinaria",
      persona: "negocio",
    });

    expect(cliente.ramoOutro).toBe("clinica veterinaria");
    expect(cliente.nichoId).toBeNull();
  });

  it("recusa sem nichoId e sem ramoOutro", async () => {
    await expect(
      salvarDadosFixos(clienteId, { nome: "Sorriso Novo", cidade: "Belo Horizonte", persona: "negocio" }),
    ).rejects.toThrow();
  });

  it("salvar os dados fixos de um cliente nao muda os de outro", async () => {
    await salvarDadosFixos(clienteId, {
      nome: "Sorriso Novo",
      cidade: "Belo Horizonte",
      nichoId: nichoAtivoId,
      persona: "negocio",
    });

    const [outroCliente] = await db().select().from(clientes).where(eq(clientes.id, outroClienteId));
    expect(outroCliente?.cidade).toBeNull();
    expect(outroCliente?.nome).toBe("[teste] Negocio B");
  });
});
