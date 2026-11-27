/**
 * E70: `hashtagsDoPost` contra o Postgres. O que prova: só vídeos do ramo da marca (isolamento), o piso de views e a régua relativa à conta
 * valem, o ramo alternativo entra com o piso dele, os últimos 90 dias, o assunto do tema entra, saúde sem promessa, sem dados devolve vazio.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, contas, nichos, ramosDaConta, user, videos } from "@/db/schema";
import { hashtagsDoPost, limparCacheDeHashtags } from "@/servicos/hashtags-do-post";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
const diasAtras = (d: number) => new Date(Date.now() - d * DIA_MS);

let principalId: number;
let alternativoId: number;
let outroRamoId: number;
let saudeId: number;
let marcaId: number;
let marcaSaudeId: number;
let marcaLocalId: number;
let sequencia = 0;

type Opcoes = { views?: number; fora?: number; dias?: number };

async function video(nichoId: number, legenda: string, opcoes: Opcoes = {}) {
  sequencia += 1;
  const [conta] = await db().insert(contas).values({ plataforma: "instagram", handle: `h70-${sequencia}`, nichoId }).returning();
  await db()
    .insert(videos)
    .values({
      plataforma: "instagram",
      idExterno: `h70-${sequencia}`,
      url: `https://exemplo.invalido/h70-${sequencia}`,
      contaId: conta.id,
      nichoId,
      titulo: legenda,
      views: opcoes.views ?? 120_000,
      foraDaCurva: String(opcoes.fora ?? 4),
      publicadoEm: diasAtras(opcoes.dias ?? 5),
      idioma: "pt",
      analise: { assunto: "a", gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", formato: "fala_para_camera", porQueFuncionou: "x" } as never,
    });
}

/** Dois vídeos de duas contas com a mesma legenda: o mínimo para a hashtag valer. */
async function par(nichoId: number, legenda: string, opcoes: Opcoes = {}) {
  await video(nichoId, legenda, opcoes);
  await video(nichoId, legenda, opcoes);
}

beforeAll(async () => {
  await resetarSchema(db());
  const [a] = await db().insert(nichos).values({ slug: "h70-principal", nome: "Principal", termos: [], pisoViews: 50_000 }).returning();
  const [b] = await db().insert(nichos).values({ slug: "h70-alternativo", nome: "Alternativo", termos: [], pisoViews: 200_000 }).returning();
  const [c] = await db().insert(nichos).values({ slug: "h70-outro", nome: "Outro ramo", termos: [], pisoViews: 50_000 }).returning();
  const [d] = await db().insert(nichos).values({ slug: "h70-saude", nome: "Dentistas", termos: [], pisoViews: 50_000, ramoCatalogo: "odontologia" }).returning();
  principalId = a.id;
  alternativoId = b.id;
  outroRamoId = c.id;
  saudeId = d.id;

  await db().insert(user).values([
    { id: "h70-u1", name: "[teste] A", email: "a@h70.teste" },
    { id: "h70-u2", name: "[teste] B", email: "b@h70.teste" },
    { id: "h70-u3", name: "[teste] C", email: "c@h70.teste" },
  ]);
  const [m1] = await db().insert(clientes).values({ usuarioId: "h70-u1", nome: "[teste] Marca", nichoId: principalId }).returning();
  const [m2] = await db().insert(clientes).values({ usuarioId: "h70-u2", nome: "[teste] Clinica", nichoId: saudeId }).returning();
  const [m3] = await db().insert(clientes).values({ usuarioId: "h70-u3", nome: "[teste] Local", nichoId: principalId, alcance: "local", regiao: "Campinas e região" }).returning();
  marcaId = m1.id;
  marcaSaudeId = m2.id;
  marcaLocalId = m3.id;
  await db().insert(ramosDaConta).values({ clienteId: marcaId, nichoId: alternativoId });
}, 60_000);

beforeEach(async () => {
  limparCacheDeHashtags();
  await db().delete(videos);
  await db().delete(contas);
});

afterAll(async () => {
  await getPool().end();
});

describe("hashtagsDoPost", () => {
  it("sem vídeo nenhum devolve vazio", async () => {
    expect(await hashtagsDoPost({ clienteId: marcaId, tema: "qualquer tema" })).toEqual([]);
  });

  it("devolve as do ramo, tira as vazias e respeita o máximo de 5", async () => {
    await par(principalId, "o segredo da limpeza #limpezadacasa #viral #fyp #reels #organizacao #faxina #dicasdelimpeza #diarista #panos");
    const r = await hashtagsDoPost({ clienteId: marcaId, tema: "tema sem relação" });
    expect(r).toHaveLength(5);
    expect(r.join(" ")).not.toMatch(/viral|fyp|reels/i);
  });

  it("isolamento: vídeo de outro ramo nunca aparece", async () => {
    await par(principalId, "dica de limpeza para você #limpezadacasa");
    await par(outroRamoId, "dica de carro para você #detalhamentoautomotivo");
    const r = await hashtagsDoPost({ clienteId: marcaId, tema: "limpeza" });
    expect(r).toEqual(["#limpezadacasa"]);
  });

  it("o piso de views e a régua relativa à conta valem", async () => {
    await par(principalId, "dica de limpeza para você #abaixodopiso", { views: 10_000 });
    await par(principalId, "dica de limpeza para você #abaixodaregua", { fora: 1.1 });
    await par(principalId, "dica de limpeza para você #passou", {});
    expect(await hashtagsDoPost({ clienteId: marcaId, tema: "limpeza" })).toEqual(["#passou"]);
  });

  it("o ramo alternativo entra com o piso dele (200 mil)", async () => {
    await par(alternativoId, "dica de lavanderia para você #lavanderiafraca", { views: 120_000 });
    await par(alternativoId, "dica de lavanderia para você #lavanderiaforte", { views: 300_000 });
    expect(await hashtagsDoPost({ clienteId: marcaId, tema: "lavanderia" })).toEqual(["#lavanderiaforte"]);
    // A outra marca não tem o alternativo ligado: nada dele chega a ela.
    expect(await hashtagsDoPost({ clienteId: marcaLocalId, tema: "lavanderia" })).toEqual([]);
  });

  it("só os últimos 90 dias", async () => {
    await par(principalId, "dica de limpeza para você #velhademais", { dias: 120 });
    await par(principalId, "dica de limpeza para você #recentedemais", { dias: 10 });
    expect(await hashtagsDoPost({ clienteId: marcaId, tema: "limpeza" })).toEqual(["#recentedemais"]);
  });

  it("o assunto do tema entra mesmo fora do topo", async () => {
    for (const h of ["#topoum", "#topodois", "#topotres", "#topoquatro", "#topocinco"]) await par(principalId, `dica de limpeza para você ${h}`, { fora: 9 });
    await par(principalId, "como tirar mancha do sofá para você #manchadesofa", { fora: 2 });
    const r = await hashtagsDoPost({ clienteId: marcaId, tema: "Como tirar mancha de sofá" });
    expect(r).toHaveLength(5);
    expect(r).toContain("#manchadesofa");
  });

  it("marca local: entra a hashtag da cidade inteira (2 vídeos de 2 contas); pedaço e um vídeo só ficam de fora", async () => {
    await par(principalId, "dica de limpeza para você #limpezadacasa #campinas #diaristacampinas");
    await video(principalId, "dica de limpeza para você #campinasrj");
    const r = await hashtagsDoPost({ clienteId: marcaLocalId, tema: "limpeza" });
    expect(r[r.length - 1]).toBe("#campinas");
    expect(r).not.toContain("#campinasrj");
  });

  it("a hashtag que é nome ou usuário de uma conta do banco (marca concorrente) fica de fora", async () => {
    await db().insert(contas).values([
      { plataforma: "instagram", handle: "redelimpa", nichoId: principalId },
      { plataforma: "instagram", handle: "x70", nome: "Casa Brilho", nichoId: principalId },
    ]);
    await par(principalId, "dica de limpeza para você #limpezadacasa #redelimpa #casabrilho");
    expect(await hashtagsDoPost({ clienteId: marcaId, tema: "limpeza" })).toEqual(["#limpezadacasa"]);
  });

  it("promessa fica de fora também fora da saúde", async () => {
    await par(principalId, "dica de limpeza para você #limpezadacasa #melhorlimpeza #gratis");
    expect(await hashtagsDoPost({ clienteId: marcaId, tema: "limpeza" })).toEqual(["#limpezadacasa"]);
  });

  it("ramo de saúde: sem hashtag que prometa resultado", async () => {
    await par(saudeId, "o cuidado com o seu sorriso #sorrisoperfeito #resultadogarantido #antesedepois #cuidadocomosdentes");
    const r = await hashtagsDoPost({ clienteId: marcaSaudeId, tema: "sorriso" });
    expect(r.join(" ")).not.toMatch(/perfeito|garantido/);
    expect(r).toContain("#antesedepois");
  });

  it("T114: hashtag de humor do vídeo de outra pessoa fica de fora quando a marca não fala com humor; com o tom brincalhão no cadastro, entra", async () => {
    await par(saudeId, "o cuidado com o seu sorriso #comedia #humor #dentista");
    expect(await hashtagsDoPost({ clienteId: marcaSaudeId, tema: "gengiva que sangra" })).toEqual(["#dentista"]);
    await db().insert(user).values({ id: "h70-u4", name: "[teste] D", email: "d@h70.teste" });
    const [brincalhona] = await db().insert(clientes).values({ usuarioId: "h70-u4", nome: "[teste] Brincalhona", nichoId: saudeId }).returning();
    await db().insert(briefings).values({ clienteId: brincalhona.id, respostas: { p9: "Bora que bora! Meu tom é brincalhão." } });
    expect((await hashtagsDoPost({ clienteId: brincalhona.id, tema: "gengiva que sangra" })).sort()).toEqual(["#comedia", "#dentista", "#humor"]);
  });

  it("marca que não existe devolve vazio, sem lançar", async () => {
    expect(await hashtagsDoPost({ clienteId: 999_999, tema: "x" })).toEqual([]);
  });
});
