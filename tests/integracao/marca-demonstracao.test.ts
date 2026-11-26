/**
 * scripts/marca-demonstracao.ts (T84): cadastra a marca inteira pelo servidor, e rodar de novo nao duplica nada. IA simulada (AI_PROVIDER=mock).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, user } from "@/db/schema";
import { membrosDaMarca } from "@/servicos/clientes";

import { cadastrarMarca, ErroDoScript, lerEntrada, type EntradaMarca } from "../../scripts/marca-demonstracao";
import { resetarSchema } from "../../scripts/resetar-schema";

const entrada: EntradaMarca = lerEntrada(
  JSON.stringify({
    marca: "[teste] Clinica Demo",
    ramo: "odontologia",
    plano: "sem_limite",
    cortesia: true,
    pessoas: [{ nome: "Pessoa Nova", email: "nova@exemplo.test" }],
    comecar: { onde: "local", regiao: "Campinas", site: "exemplo.com.br", objetivo: "negocio", perfis: { instagram: "@clinica.demo" } },
    briefing: { p1: "Clinica de bairro com dez anos, focada em familias.", p2: "Maes com filhos pequenos do bairro." },
    foco: "Cuidado com os dentes da familia inteira, para maes e pais",
    cor: "#1f6feb",
  }),
);
const normal = { simular: false, convidar: true, mostrarSenhas: false };

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

async function contagens() {
  const [m, u, g] = await Promise.all([db().select().from(clientes), db().select().from(user), db().select().from(geracoesIA)]);
  return { marcas: m.length, usuarios: u.length, geracoes: g.length };
}

describe("marca-demonstracao", () => {
  it("--simular nao grava nada nem chama a IA", async () => {
    const r = await cadastrarMarca(entrada, { ...normal, simular: true });
    expect(r.marcaId).toBeNull();
    expect(await contagens()).toEqual({ marcas: 0, usuarios: 0, geracoes: 0 });
    expect(r.notas.every((n) => n.situacao === "sera avaliada")).toBe(true);
  });

  it("gente sem conta sem --convidar para antes de gravar", async () => {
    await expect(cadastrarMarca(entrada, { ...normal, convidar: false })).rejects.toBeInstanceOf(ErroDoScript);
    expect((await contagens()).marcas).toBe(0);
  });

  it("cria marca, cortesia, acesso, Comecar, briefing avaliado, foco e cor", async () => {
    const r = await cadastrarMarca(entrada, normal);
    expect(r.marcaId).not.toBeNull();
    const [marca] = await db().select().from(clientes).where(eq(clientes.id, r.marcaId!));
    expect(marca).toMatchObject({ nome: entrada.marca, plano: "sem_limite", cortesia: true, alcance: "local", regiao: "Campinas", corMarca: "#1f6feb" });
    expect(marca.foco).toContain("dentes");
    expect(marca.focoConfirmadoEm).not.toBeNull();
    expect((await membrosDaMarca(marca.id)).map((m) => m.email)).toEqual(["nova@exemplo.test"]);
    expect(r.notas.map((n) => n.situacao)).toEqual(["avaliada agora", "avaliada agora"]);
    const [b] = await db().select().from(briefings).where(eq(briefings.clienteId, marca.id));
    expect(Object.keys(b.avaliacoes).sort()).toEqual(["p1", "p2"]);
    expect(r.faltando.some((f) => f.startsWith("briefing p3"))).toBe(true);
    expect(r.senhas).toEqual([]);
  }, 60_000);

  it("rodar de novo nao duplica marca, conta, acesso nem reavalia", async () => {
    const antes = await contagens();
    const r = await cadastrarMarca(entrada, normal);
    expect(r.marcaJaExistia).toBe(true);
    expect(await contagens()).toEqual(antes);
    expect(r.notas.map((n) => n.situacao)).toEqual(["ja avaliada", "ja avaliada"]);
    expect((await membrosDaMarca(r.marcaId!)).length).toBe(1);
  }, 60_000);

  it("resposta que mudou e reavaliada", async () => {
    const mudada = { ...entrada, briefing: { ...entrada.briefing, p1: "Clinica com doze anos, focada em familias e criancas." } };
    const antes = (await contagens()).geracoes;
    const r = await cadastrarMarca(mudada, normal);
    expect(r.notas[0].situacao).toBe("avaliada agora");
    expect((await contagens()).geracoes).toBeGreaterThan(antes);
  }, 60_000);

  it("entrada invalida (ramo fora do catalogo) para antes de gravar", async () => {
    await expect(cadastrarMarca({ ...entrada, marca: "Outra", ramo: "nao-existe" }, normal)).rejects.toThrow(/catalogo/);
  });
});
