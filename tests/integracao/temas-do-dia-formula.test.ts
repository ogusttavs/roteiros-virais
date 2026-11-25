/**
 * Onda 1 de texto (25/11/2026): o tema do dia com fórmula de texto de máquina no título (`R-COPY-26`) volta para o modelo com o motivo na 1ª passada;
 * na 2ª fica e só vira aviso: o dia nunca fecha sem tema por causa de um enfeite. Postgres real, IA simulada.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, contas, geracoesIA, nichos, temasDia, videos } from "@/db/schema";
import { rodarTemasDoDia } from "@/jobs/temas-do-dia";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
let nichoId: number;
let contas2: number[];

async function criarVideosComProva(assunto: string) {
  for (let i = 0; i < 3; i += 1) {
    await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: `formula-${i}`,
        url: `https://exemplo.invalido/formula-${i}`,
        nichoId,
        contaId: contas2[i % 2],
        titulo: `[exemplo] formula-${i}`,
        views: 100,
        publicadoEm: new Date(Date.now() - 3 * DIA_MS),
        velocidadeRelativa: String(5 + i),
        idioma: "pt",
        analise: { assunto, gancho: "x", estrutura: "x", fechamento: "x", chamadaFinal: "x", formato: "fala_para_camera", porQueFuncionou: "x" } as never,
      });
  }
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "temas-formula", nome: "Temas fórmula", termos: [], criadoEm: new Date(Date.now() - 30 * DIA_MS) }).returning();
  nichoId = nicho.id;
  const criadas = await db().insert(contas).values([{ plataforma: "youtube", handle: "formula-a", nichoId }, { plataforma: "youtube", handle: "formula-b", nichoId }]).returning({ id: contas.id });
  contas2 = criadas.map((c) => c.id);
  await db().insert(clientes).values({ nome: "[teste] marca em uso", nichoId, ultimoAcessoEm: new Date() });
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(temasDia).where(eq(temasDia.nichoId, nichoId));
  await db().delete(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"));
});

describe("tema do dia com fórmula de máquina", () => {
  it("sem fórmula: uma chamada só e três temas", async () => {
    await criarVideosComProva("erro comum ao lavar sofa");
    await rodarTemasDoDia();
    expect(await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"))).toHaveLength(1);
  });

  it("1ª passada com fórmula: o modelo é chamado de novo com o motivo e os temas finais saem limpos", async () => {
    await criarVideosComProva("erro comum ao lavar sofa [mock:formula-tema]");
    const resumo = await rodarTemasDoDia();
    expect(resumo.falhas).toBe(0);
    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linha.temas).toHaveLength(3);
    expect(linha.temas.every((t) => !t.titulo.startsWith("Descubra"))).toBe(true);
    expect(await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"))).toHaveLength(2);
  });

  it("fórmula nas duas passadas: os temas ficam (só aviso), o dia não fecha vazio", async () => {
    await criarVideosComProva("erro comum ao lavar sofa [mock:formula-tema-sempre]");
    const resumo = await rodarTemasDoDia();
    expect(resumo.falhas).toBe(0);
    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linha.temas.length).toBeGreaterThan(0);
    expect(linha.temas.some((t) => t.titulo.startsWith("Descubra"))).toBe(true);
  });
});
