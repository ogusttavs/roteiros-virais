/**
 * A capa das Notícias (E53, passo 20) contra o Postgres real: junta as do setor e as dos assuntos da marca, as mais novas primeiro, separa as de hoje das de ontem, tira a antiga, junta a mesma
 * manchete, revalida os endereços (só https; o resto vira nulo), avisa do assunto perto de sair e nunca mistura as notícias de uma marca com as de outra.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { assuntosDaMarca, clientes, nichos, noticias, noticiasDoAssunto } from "@/db/schema";
import { adicionarAssunto } from "@/servicos/assuntos";
import { capaDoDia, inicioDoDiaEmSaoPaulo } from "@/servicos/noticias-do-dia";

import { resetarSchema } from "../../scripts/resetar-schema";

// Meio-dia de São Paulo: "hoje" começa às 03:00 UTC e as de até 5 horas atrás ainda são de hoje.
const AGORA = new Date("2026-10-06T15:00:00Z");
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

let marcaA: number;
let marcaB: number;
let nichoId: number;
let politicaId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "capa-teste", nome: "Produtos de limpeza", termos: [] }).returning();
  nichoId = nicho.id;
  const marcas = await db()
    .insert(clientes)
    .values([
      { nome: "marca A", nichoId },
      { nome: "marca B", nichoId },
    ])
    .returning({ id: clientes.id });
  marcaA = marcas[0].id;
  marcaB = marcas[1].id;
  politicaId = (await adicionarAssunto(marcaA, "política", "eleição")).id;

  await db()
    .insert(noticias)
    .values([
      { nichoId, titulo: "Setor de hoje", url: "https://g1.globo.com/setor-hoje", fonte: "G1", publicadoEm: new Date(AGORA.getTime() - 2 * HORA), resumo: "r", relevante: true },
      { nichoId, titulo: "Setor de ontem", url: "https://g1.globo.com/setor-ontem", fonte: "G1", publicadoEm: new Date(inicioDoDiaEmSaoPaulo(AGORA).getTime() - 2 * HORA), resumo: null, relevante: true },
      { nichoId, titulo: "Setor antiga", url: "https://g1.globo.com/setor-antiga", fonte: "G1", publicadoEm: new Date(AGORA.getTime() - 10 * DIA), resumo: null, relevante: true },
      { nichoId, titulo: "Setor não relevante", url: "https://g1.globo.com/setor-nr", fonte: "G1", publicadoEm: new Date(AGORA.getTime() - 1 * HORA), resumo: null, relevante: false },
      { nichoId, titulo: "Setor com endereço ruim", url: "javascript:alert(1)", fonte: "G1", publicadoEm: new Date(AGORA.getTime() - 3 * HORA), resumo: null, relevante: true },
    ]);
  await db()
    .insert(noticiasDoAssunto)
    .values([
      { assuntoId: politicaId, titulo: "Debate esquenta", veiculo: "Folha", url: "https://www1.folha.uol.com.br/a", publicadoEm: new Date(AGORA.getTime() - 1 * HORA), imagemUrl: "https://f.i.uol.com.br/a.jpg", imagemCredito: "Foto: Folha", resumoNosso: "resumo", origem: "rss", coletadoEm: new Date(AGORA.getTime() - 1 * HORA) },
      // A mesma manchete do setor, sem acento nem pontuação: entra uma vez só.
      { assuntoId: politicaId, titulo: "Setor de hoje!", veiculo: "G1", url: "https://g1.globo.com/outra", publicadoEm: new Date(AGORA.getTime() - 4 * HORA), origem: "rss", coletadoEm: new Date(AGORA.getTime() - 4 * HORA) },
      // Foto e link que não são https: viram nulos.
      { assuntoId: politicaId, titulo: "Foto ruim", veiculo: "Rádio", url: "http://radio.exemplo/a", publicadoEm: new Date(AGORA.getTime() - 5 * HORA), imagemUrl: "http://radio.exemplo/a.jpg", imagemCredito: "Foto: Rádio", origem: "rss", coletadoEm: new Date(AGORA.getTime() - 5 * HORA) },
      { assuntoId: politicaId, titulo: "Assunto antiga", veiculo: "Folha", url: "https://www1.folha.uol.com.br/velha", publicadoEm: new Date(AGORA.getTime() - 9 * DIA), origem: "rss", coletadoEm: new Date(AGORA.getTime() - 9 * DIA) },
    ]);
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

describe("a capa do dia", () => {
  it("junta o setor e os assuntos, as mais novas primeiro, separa hoje de ontem e tira a antiga, a não relevante e a repetida", async () => {
    const capa = await capaDoDia({ id: marcaA, nichoId }, AGORA);
    expect(capa.nomeDoSetor).toBe("Produtos de limpeza");
    expect(capa.deHoje.map((n) => n.titulo)).toEqual(["Debate esquenta", "Setor de hoje", "Setor com endereço ruim", "Foto ruim"]);
    expect(capa.deOntem.map((n) => n.titulo)).toEqual(["Setor de ontem"]);
    expect(capa.novasDesdeOntem).toBe(5);
    const todos = [...capa.deHoje, ...capa.deOntem].map((n) => n.titulo);
    expect(todos).not.toContain("Setor antiga");
    expect(todos).not.toContain("Setor não relevante");
    expect(todos).not.toContain("Assunto antiga");
  });

  it("diz de onde veio cada uma: o setor ou o assunto, com a foto e o crédito do veículo", async () => {
    const capa = await capaDoDia({ id: marcaA, nichoId }, AGORA);
    const debate = capa.deHoje.find((n) => n.titulo === "Debate esquenta")!;
    expect(debate).toMatchObject({ tipo: "assunto", origemRotulo: "política", veiculo: "Folha", imagemUrl: "https://f.i.uol.com.br/a.jpg", imagemCredito: "Foto: Folha", url: "https://www1.folha.uol.com.br/a" });
    const setor = capa.deHoje.find((n) => n.titulo === "Setor de hoje")!;
    expect(setor).toMatchObject({ tipo: "setor", origemRotulo: "Produtos de limpeza", imagemUrl: null });
  });

  it("revalida os endereços: o que não é https vira nulo, a foto e o crédito junto", async () => {
    const capa = await capaDoDia({ id: marcaA, nichoId }, AGORA);
    const ruim = capa.deHoje.find((n) => n.titulo === "Foto ruim")!;
    expect(ruim).toMatchObject({ url: null, imagemUrl: null, imagemCredito: null });
    expect(capa.deHoje.find((n) => n.titulo === "Setor com endereço ruim")!.url).toBeNull();
  });

  it("os assuntos vêm com a contagem, e o parado há mais de 20 dias avisa em quantos dias sai; o fixado nunca", async () => {
    await db().update(assuntosDaMarca).set({ criadoEm: new Date(AGORA.getTime() - 25 * DIA), ultimoAbertoEm: new Date(AGORA.getTime() - 25 * DIA) });
    const capa = await capaDoDia({ id: marcaA, nichoId }, AGORA);
    expect(capa.assuntos).toHaveLength(1);
    expect(capa.assuntos[0]).toMatchObject({ texto: "política", noticias: 4, diasSemAbrir: 25, saiEmDias: 5, fixado: false });
    await db().update(assuntosDaMarca).set({ fixado: true });
    expect((await capaDoDia({ id: marcaA, nichoId }, AGORA)).assuntos[0].saiEmDias).toBeNull();
    await db().update(assuntosDaMarca).set({ fixado: false, ultimoAbertoEm: new Date(AGORA.getTime() - 2 * DIA) });
    expect((await capaDoDia({ id: marcaA, nichoId }, AGORA)).assuntos[0]).toMatchObject({ diasSemAbrir: 2, saiEmDias: null });
  });

  it("a outra marca do mesmo setor só vê as do setor: nunca as notícias nem os assuntos da primeira", async () => {
    const capa = await capaDoDia({ id: marcaB, nichoId }, AGORA);
    expect(capa.assuntos).toEqual([]);
    expect([...capa.deHoje, ...capa.deOntem].every((n) => n.tipo === "setor")).toBe(true);
    expect(capa.deHoje.map((n) => n.titulo)).toContain("Setor de hoje");
  });

  it("marca sem setor e sem assunto: a capa vem vazia, sem erro", async () => {
    const [sem] = await db().insert(clientes).values({ nome: "sem setor", nichoId: null }).returning({ id: clientes.id });
    expect(await capaDoDia({ id: sem.id, nichoId: null }, AGORA)).toEqual({ nomeDoSetor: "", deHoje: [], deOntem: [], assuntos: [], novasDesdeOntem: 0 });
  });
});
