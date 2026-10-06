/**
 * O sinal de momento da nota do tema (06/10/2026): as notícias de hoje (setor e assuntos da marca) que tocam o tema, contra o Postgres real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, noticias, noticiasDoAssunto } from "@/db/schema";
import { adicionarAssunto } from "@/servicos/assuntos";
import { noticiasQueTocamOTema } from "@/servicos/noticias-do-tema";

import { resetarSchema } from "../../scripts/resetar-schema";

const AGORA = new Date("2026-10-06T15:00:00Z");
const HORA = 60 * 60 * 1000;

let marcaA: number;
let marcaB: number;
let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "tema-teste", nome: "Empreendedorismo", termos: [] }).returning();
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
  const politica = await adicionarAssunto(marcaA, "política", "eleição");
  await db()
    .insert(noticias)
    .values([
      { nichoId, titulo: "Eleições movimentam o comércio das cidades", url: "https://g1.globo.com/a", fonte: "G1", publicadoEm: new Date(AGORA.getTime() - 2 * HORA), resumo: null, relevante: true },
      { nichoId, titulo: "Como abrir uma loja de estofados", url: "https://g1.globo.com/b", fonte: "G1", publicadoEm: new Date(AGORA.getTime() - 3 * HORA), resumo: null, relevante: true },
      { nichoId, titulo: "Eleições antigas", url: "https://g1.globo.com/c", fonte: "G1", publicadoEm: new Date(AGORA.getTime() - 5 * 24 * HORA), resumo: null, relevante: true },
      { nichoId, titulo: "Eleições que ninguém marcou como relevantes", url: "https://g1.globo.com/d", fonte: "G1", publicadoEm: new Date(AGORA.getTime() - 1 * HORA), resumo: null, relevante: false },
    ]);
  await db()
    .insert(noticiasDoAssunto)
    .values([{ assuntoId: politica.id, titulo: "Debate esquenta a eleição e divide os candidatos", veiculo: "Folha", url: "https://www1.folha.uol.com.br/a", publicadoEm: new Date(AGORA.getTime() - 1 * HORA), origem: "rss", coletadoEm: new Date(AGORA.getTime() - 1 * HORA) }]);
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

describe("as notícias de hoje que tocam o tema", () => {
  it("junta a do setor (pela raiz da palavra: 'eleição' casa com 'Eleições') e a do assunto da marca, as mais novas primeiro, sem a antiga nem a não relevante", async () => {
    const lista = await noticiasQueTocamOTema({ id: marcaA, nichoId }, "o que a eleição muda para o meu negócio", AGORA);
    expect(lista.map((n) => n.titulo)).toEqual(["Debate esquenta a eleição e divide os candidatos", "Eleições movimentam o comércio das cidades"]);
    expect(lista.map((n) => n.origem)).toEqual(["assunto", "setor"]);
    expect(lista[0]).toMatchObject({ veiculo: "Folha", dia: "6 de outubro" });
  });

  it("a marca sem o assunto só recebe a do setor, e um tema que nenhuma toca recebe lista vazia", async () => {
    const semAssunto = await noticiasQueTocamOTema({ id: marcaB, nichoId }, "o que a eleição muda para o meu negócio", AGORA);
    expect(semAssunto.map((n) => n.origem)).toEqual(["setor"]);
    expect(await noticiasQueTocamOTema({ id: marcaA, nichoId }, "quanto custa limpar um colchão", AGORA)).toEqual([]);
  });

  it("marca sem setor: só as dos assuntos", async () => {
    const lista = await noticiasQueTocamOTema({ id: marcaA, nichoId: null }, "a eleição", AGORA);
    expect(lista.map((n) => n.origem)).toEqual(["assunto"]);
  });
});
