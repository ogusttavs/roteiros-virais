/**
 * `rodarTemasDoDia` (etapa 10): ciclo completo contra o Postgres real.
 * `AI_PROVIDER=mock` (`vitest.config.mts`) faz `gerarEstruturado` cair no
 * mock de `temasDoDia` e `filtrarNoticias`, sem chamar a Anthropic de
 * verdade.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { geracoesIA, nichos, noticias, temasDia, videos } from "@/db/schema";
import { rodarTemasDoDia } from "@/jobs/temas-do-dia";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

let nichoId: number;

async function criarVideo(idExterno: string, opcoes: { velocidadeRelativa: number; assunto: string }) {
  await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      nichoId,
      titulo: `[exemplo] ${idExterno}`,
      views: 100,
      publicadoEm: diasAtras(3),
      velocidadeRelativa: String(opcoes.velocidadeRelativa),
      analise: {
        assunto: opcoes.assunto,
        gancho: "x",
        estrutura: "x",
        fechamento: "x",
        chamadaFinal: "x",
        formato: "fala_para_camera",
        porQueFuncionou: "x",
      } as never,
    });
}

async function criarNoticia(url: string, opcoes: { titulo: string; resumo?: string; coletadoEm?: Date }) {
  await db()
    .insert(noticias)
    .values({
      nichoId,
      url,
      titulo: opcoes.titulo,
      resumo: opcoes.resumo,
      coletadoEm: opcoes.coletadoEm ?? new Date(),
    });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "temas-do-dia-teste", nome: "Temas do dia teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(noticias).where(eq(noticias.nichoId, nichoId));
  await db().delete(temasDia).where(eq(temasDia.nichoId, nichoId));
  await db().delete(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"));
});

describe("rodarTemasDoDia", () => {
  it("com video subindo hoje, gera tres temas com evidencia e grava em temas_dia", async () => {
    await criarVideo("video-1", { velocidadeRelativa: 5, assunto: "erro comum ao lavar sofa" });

    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(1);
    expect(resumo.semEvidencia).toBe(0);
    expect(resumo.falhas).toBe(0);

    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linha.temas).toHaveLength(3);
    for (const tema of linha.temas) {
      expect(tema.evidencias.length).toBeGreaterThan(0);
    }
  });

  it("sem video subindo e sem noticia, nao gera tema e o resumo diz sem evidencia", async () => {
    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(0);
    expect(resumo.semEvidencia).toBe(1);
    expect(resumo.falhas).toBe(0);

    const linhas = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linhas).toHaveLength(0);
  });

  it("filtra e grava relevante/angulo nas noticias das ultimas 24h, ignorando a de mais de 24h", async () => {
    await criarVideo("video-2", { velocidadeRelativa: 5, assunto: "assunto qualquer" });
    await criarNoticia("https://exemplo.invalido/noticia-recente", {
      titulo: "noticia de hoje sobre o nicho",
      resumo: "resumo da noticia",
    });
    await criarNoticia("https://exemplo.invalido/noticia-velha", {
      titulo: "noticia de mais de um dia atras",
      coletadoEm: new Date(Date.now() - 2 * DIA_MS),
    });

    await rodarTemasDoDia();

    const [recente] = await db()
      .select()
      .from(noticias)
      .where(eq(noticias.url, "https://exemplo.invalido/noticia-recente"));
    expect(recente.relevante).not.toBeNull();

    const [velha] = await db().select().from(noticias).where(eq(noticias.url, "https://exemplo.invalido/noticia-velha"));
    expect(velha.relevante).toBeNull();
  });

  it("nicho com noticia relevante e nenhum video com analise gera tres temas com evidenciasNoticias", async () => {
    await criarNoticia("https://exemplo.invalido/noticia-so", {
      titulo: "noticia relevante do nicho",
      resumo: "resumo da noticia relevante",
    });

    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(1);
    expect(resumo.semEvidencia).toBe(0);
    expect(resumo.falhas).toBe(0);

    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linha.temas).toHaveLength(3);
    for (const tema of linha.temas) {
      expect(tema.evidencias).toHaveLength(0);
      expect(tema.evidenciasNoticias?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("resposta com id de evidencia inventado nas duas tentativas registra duas geracoes reprovadas e falhas: 1", async () => {
    await criarVideo("video-evidencia-inventada", {
      velocidadeRelativa: 5,
      assunto: "invente um id de evidencia que nao existe",
    });

    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(0);
    expect(resumo.falhas).toBe(1);
    expect((resumo.erros as string[] | undefined)?.[0]).toContain(
      "sem evidencia valida depois de refazer a chamada uma vez",
    );

    const linhas = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linhas).toHaveLength(0);

    const geracoes = await db()
      .select()
      .from(geracoesIA)
      .where(eq(geracoesIA.tarefa, "temasDoDia"));
    expect(geracoes).toHaveLength(2);
    for (const geracao of geracoes) {
      expect((geracao.entradas as { evidenciaValida?: boolean }).evidenciaValida).toBe(false);
    }
  });

  it("rodar de novo no mesmo dia substitui os temas gravados (upsert)", async () => {
    await criarVideo("video-3", { velocidadeRelativa: 5, assunto: "assunto original" });
    await rodarTemasDoDia();

    const antes = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(antes).toHaveLength(1);

    await rodarTemasDoDia();

    const depois = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(depois).toHaveLength(1);
  });
});
