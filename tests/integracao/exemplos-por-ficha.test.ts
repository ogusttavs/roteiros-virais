/**
 * "Para que o vídeo parece feito" (E49 PR 2), contra o Postgres real: os exemplos por ficha do Criar respeitam os ramos da conta, o filtro de tipo ligado da marca e o corte duro de
 * recorte e notícia; vídeo sem ficha não conta; o filtro "Parece feito para" das Referências e as contagens por ficha.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, contas, nichos, user, videos } from "@/db/schema";
import { filtroDeFormatosDaMarca, responderFormatosDoCliente } from "@/servicos/formatos";
import { contagensPorFiltroReferencias, exemplosPorFicha, referenciasDoNicho } from "@/servicos/pesquisa";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
const diasAtras = (dias: number) => new Date(Date.now() - dias * DIA_MS);

const ANALISE = { assunto: "a", gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", porQueFuncionou: "p", formato: "fala_para_camera" };

let principal: number;
let alternativo: number;
let foraDaConta: number;
let marca: number;
let marcaSemMeme: number;
let n = 0;

async function video(nicho: number, opcoes: { ficha: string | null; formato?: string | null; serveDeModelo?: boolean | null; tipoConteudo?: "original" | "meme" | "recorte"; foraDaCurva?: string; views?: number }) {
  n += 1;
  const [conta] = await db().insert(contas).values({ plataforma: "tiktok", handle: `ficha-conta-${n}`, nichoId: nicho }).returning();
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: "tiktok",
      idExterno: `ficha-${n}`,
      url: `https://exemplo.invalido/ficha-${n}`,
      titulo: `video ${n}`,
      contaId: conta.id,
      nichoId: nicho,
      views: opcoes.views ?? 100_000,
      publicadoEm: diasAtras(2),
      foraDaCurva: opcoes.foraDaCurva ?? "9",
      idioma: "pt",
      analise: { ...ANALISE, assunto: `assunto ${n}` } as never,
      formatoCatalogo: opcoes.formato ?? "passo_a_passo",
      fichaCatalogo: opcoes.ficha as never,
      serveDeModelo: opcoes.serveDeModelo ?? true,
      tipoConteudo: opcoes.tipoConteudo ?? "original",
    })
    .returning();
  return v.id;
}

async function criarMarca(nome: string): Promise<number> {
  const usuario = `ficha-${nome}`;
  await db().insert(user).values({ id: usuario, name: nome, email: `${usuario}@exemplo.teste` });
  const [c] = await db().insert(clientes).values({ usuarioId: usuario, nome, nichoId: principal }).returning();
  return c.id;
}

const ids: Record<string, number> = {};

beforeAll(async () => {
  await resetarSchema(db());
  const [a] = await db().insert(nichos).values({ slug: "ficha-principal", nome: "Principal", termos: [] }).returning();
  const [b] = await db().insert(nichos).values({ slug: "ficha-alternativo", nome: "Alternativo", termos: [] }).returning();
  const [c] = await db().insert(nichos).values({ slug: "ficha-fora", nome: "Fora da conta", termos: [] }).returning();
  principal = a.id;
  alternativo = b.id;
  foraDaConta = c.id;
  marca = await criarMarca("padrao");
  marcaSemMeme = await criarMarca("sem-meme");

  ids.guardemP1 = await video(principal, { ficha: "guardem", foraDaCurva: "9" });
  ids.guardemP2 = await video(principal, { ficha: "guardem", foraDaCurva: "5" });
  ids.guardemAlt = await video(alternativo, { ficha: "guardem", foraDaCurva: "7" });
  ids.guardemFora = await video(foraDaConta, { ficha: "guardem" });
  ids.semFicha = await video(principal, { ficha: null });
  ids.comentem = await video(principal, { ficha: "comentem" });
  // Meme que parece feito para mandar: só com "humor e meme" ligado.
  ids.mandemMeme = await video(principal, { ficha: "mandem", formato: "humor_e_meme", serveDeModelo: false, tipoConteudo: "meme" });
  // Recorte de outro: nunca é exemplo (corte duro).
  ids.guardemRecorte = await video(principal, { ficha: "guardem", formato: "recorte_de_outro", serveDeModelo: false, tipoConteudo: "recorte" });
  await responderFormatosDoCliente(marcaSemMeme, { humor_e_meme: false }, "ficha-sem-meme");
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

describe("exemplosPorFicha", () => {
  it("traz só vídeos da ficha escolhida, do ramo principal e dos alternativos da conta, os melhores primeiro", async () => {
    const lista = await exemplosPorFicha(principal, "guardem", { setores: [{ id: principal, pisoViews: 0 }, { id: alternativo, pisoViews: 0 }] });
    const idsDaLista = lista.map((v) => v.id);
    expect(idsDaLista).toEqual([ids.guardemP1, ids.guardemAlt, ids.guardemP2]);
    expect(lista.every((v) => v.fichaCatalogo === "guardem")).toBe(true);
  });

  it("não traz vídeo de ramo que não é da conta, nem sem ficha classificada, nem recorte", async () => {
    const lista = (await exemplosPorFicha(principal, "guardem", { setores: [{ id: principal, pisoViews: 0 }] })).map((v) => v.id);
    expect(lista).not.toContain(ids.guardemFora);
    expect(lista).not.toContain(ids.guardemAlt);
    expect(lista).not.toContain(ids.semFicha);
    expect(lista).not.toContain(ids.guardemRecorte);
  });

  it("o limite é de três", async () => {
    for (let i = 0; i < 3; i++) await video(principal, { ficha: "guardem", foraDaCurva: "4" });
    expect(await exemplosPorFicha(principal, "guardem")).toHaveLength(3);
  });

  it("o filtro de tipo da marca vale: o meme só aparece para quem ligou 'humor e meme'", async () => {
    const semMeme = await exemplosPorFicha(principal, "mandem", { formatosDaMarca: await filtroDeFormatosDaMarca(marcaSemMeme) });
    expect(semMeme.map((v) => v.id)).not.toContain(ids.mandemMeme);
    const comMeme = await exemplosPorFicha(principal, "mandem", { formatosDaMarca: await filtroDeFormatosDaMarca(marca) });
    // Sem resposta da marca, o corte duro de meme da H4 continua valendo (serveDeModelo false): também não aparece.
    expect(comMeme.map((v) => v.id)).not.toContain(ids.mandemMeme);
  });

  it("sem nenhum vídeo da ficha, a lista vem vazia (o estado 'ainda não temos exemplos')", async () => {
    expect(await exemplosPorFicha(principal, "me_chamem")).toEqual([]);
  });
});

describe("o filtro 'Parece feito para' das Referências", () => {
  it("filtra pela ficha e conta por ficha mantendo os outros filtros", async () => {
    const guardem = await referenciasDoNicho(principal, { fichas: ["guardem"], periodoDias: 30, formatosDaMarca: await filtroDeFormatosDaMarca(marca) });
    expect(guardem.videos.length).toBeGreaterThan(0);
    expect(guardem.videos.every((v) => v.fichaCatalogo === "guardem")).toBe(true);

    const contagens = await contagensPorFiltroReferencias(principal, { periodoDias: 30, formatosDaMarca: await filtroDeFormatosDaMarca(marca) });
    expect(contagens.porFicha.guardem).toBeGreaterThanOrEqual(guardem.videos.length);
    expect(contagens.porFicha.comentem).toBe(1);
    expect(contagens.porFicha.me_chamem).toBe(0);
  });
});
