/**
 * A faxina diária das versões do roteiro (E26 4c): o grupo parado há mais de 30 dias perde as versões que ninguém escolheu, resolvido ou abandonado; a que virou roteiro fica; um grupo que
 * ganhou "Gerar outra" há pouco fica inteiro. Contra o Postgres real, com o simulador de IA.
 */
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, nichos, roteiros, user, versoesDoRoteiro } from "@/db/schema";
import { rodarFaxinaDasVersoes } from "@/jobs/faxina-versoes";
import { ficarComVersao, faxinarVersoes, gerarOutraVersao, gerarVersoes } from "@/servicos/versoes";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA = 86_400_000;
let marcaA: number;
let marcaB: number;

const pedido = (texto: string) => ({ origem: "livre" as const, textoTema: texto, objetivo: "conversao" as const });

/** Põe todas as versões do grupo "há tantos dias". */
async function envelhecer(grupo: string, dias: number) {
  await db()
    .update(versoesDoRoteiro)
    .set({ criadoEm: new Date(Date.now() - dias * DIA) })
    .where(eq(versoesDoRoteiro.grupo, grupo));
}

async function linhasDoGrupo(grupo: string) {
  return db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.grupo, grupo));
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "faxina-versoes", nome: "Faxina das versões", termos: ["limpeza"] }).returning();
  const perfil = {
    fatos: { oQueVende: "kit tira-mancha", preco: "kit a partir de 89 reais", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
    resumo: "produtos de limpeza",
    referencias: [],
  };
  for (const id of ["faxina-a", "faxina-b"]) await db().insert(user).values({ id, name: id, email: `${id}@exemplo.teste` });
  const [a] = await db().insert(clientes).values({ usuarioId: "faxina-a", nome: "A", nichoId: nicho.id }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "faxina-b", nome: "B", nichoId: nicho.id }).returning();
  marcaA = a.id;
  marcaB = b.id;
  await db().insert(briefings).values([
    { clienteId: a.id, completo: true, perfil },
    { clienteId: b.id, completo: true, perfil },
  ]);
}, 60_000);

beforeEach(async () => {
  await db().delete(versoesDoRoteiro);
  await db().delete(roteiros);
});

afterAll(async () => {
  await getPool().end();
});

describe("faxinarVersoes", () => {
  it("o grupo abandonado há mais de 30 dias perde todas as versões; o de 29 dias fica inteiro", async () => {
    const velho = await gerarVersoes(marcaA, pedido("velho"), 3);
    const recente = await gerarVersoes(marcaA, pedido("recente"), 3);
    await envelhecer(velho.grupo, 31);
    await envelhecer(recente.grupo, 29);

    const resumo = await faxinarVersoes();

    expect(resumo).toEqual({ gruposLimpos: 1, versoesApagadas: 3, versoesMantidasPorEscolha: 0, dias: 30 });
    expect(await linhasDoGrupo(velho.grupo)).toHaveLength(0);
    expect(await linhasDoGrupo(recente.grupo)).toHaveLength(3);
  });

  it("o grupo resolvido perde as que ninguém escolheu e guarda a que virou roteiro (o roteiro continua inteiro)", async () => {
    const { grupo, versoes } = await gerarVersoes(marcaA, pedido("resolvido"), 3);
    const roteiro = await ficarComVersao(marcaA, versoes[1].id);
    await envelhecer(grupo, 45);

    const resumo = await faxinarVersoes();

    expect(resumo).toMatchObject({ gruposLimpos: 1, versoesApagadas: 2, versoesMantidasPorEscolha: 1 });
    const restantes = await linhasDoGrupo(grupo);
    expect(restantes).toHaveLength(1);
    expect(restantes[0]).toMatchObject({ id: versoes[1].id, roteiroId: roteiro.id });
    expect(await db().select().from(roteiros).where(eq(roteiros.id, roteiro.id))).toHaveLength(1);
  });

  it("um grupo antigo que ganhou 'Gerar outra' há pouco fica inteiro (conta a versão mais nova)", async () => {
    const { grupo } = await gerarVersoes(marcaA, pedido("reaberto"), 3);
    await envelhecer(grupo, 60);
    await gerarOutraVersao(marcaA, grupo);

    const resumo = await faxinarVersoes();

    expect(resumo).toMatchObject({ gruposLimpos: 0, versoesApagadas: 0 });
    expect(await linhasDoGrupo(grupo)).toHaveLength(4);
  });

  it("a versão que ficou sem roteiro porque o roteiro foi apagado sai na faxina seguinte", async () => {
    const { grupo, versoes } = await gerarVersoes(marcaA, pedido("roteiro apagado"), 2);
    const roteiro = await ficarComVersao(marcaA, versoes[0].id);
    await envelhecer(grupo, 40);
    expect((await faxinarVersoes()).versoesMantidasPorEscolha).toBe(1);

    await db().delete(roteiros).where(eq(roteiros.id, roteiro.id));
    const resumo = await faxinarVersoes();

    expect(resumo).toMatchObject({ versoesApagadas: 1, versoesMantidasPorEscolha: 0 });
    expect(await linhasDoGrupo(grupo)).toHaveLength(0);
  });

  it("vale para todas as marcas de uma vez, e só para os grupos parados", async () => {
    const a = await gerarVersoes(marcaA, pedido("da A"), 2);
    const b = await gerarVersoes(marcaB, pedido("da B"), 2);
    const nova = await gerarVersoes(marcaB, pedido("nova da B"), 2);
    await envelhecer(a.grupo, 31);
    await envelhecer(b.grupo, 90);

    const resumo = await faxinarVersoes();

    expect(resumo).toMatchObject({ gruposLimpos: 2, versoesApagadas: 4 });
    expect(await linhasDoGrupo(nova.grupo)).toHaveLength(2);
    expect(await db().select().from(versoesDoRoteiro).where(inArray(versoesDoRoteiro.clienteId, [marcaA, marcaB]))).toHaveLength(2);
  });

  it("os dias vêm de DIAS_DAS_VERSOES_GUARDADAS e podem ser dados à mão; rodar de novo não apaga mais nada", async () => {
    const { grupo } = await gerarVersoes(marcaA, pedido("dez dias"), 3);
    await envelhecer(grupo, 10);

    expect(await faxinarVersoes(new Date(), 30)).toMatchObject({ versoesApagadas: 0 });
    expect(await faxinarVersoes(new Date(), 7)).toMatchObject({ versoesApagadas: 3, dias: 7 });
    expect(await faxinarVersoes(new Date(), 7)).toMatchObject({ gruposLimpos: 0, versoesApagadas: 0, versoesMantidasPorEscolha: 0 });
  });
});

describe("rodarFaxinaDasVersoes", () => {
  it("devolve o número no resumo da execução (o que a tela de rotinas do admin mostra)", async () => {
    const { grupo } = await gerarVersoes(marcaA, pedido("para o resumo"), 3);
    await envelhecer(grupo, 31);

    const resumo = await rodarFaxinaDasVersoes();

    expect(resumo).toEqual({ gruposLimpos: 1, versoesApagadas: 3, versoesMantidasPorEscolha: 0, dias: 30 });
  });
});
