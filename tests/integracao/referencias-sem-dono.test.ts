/**
 * Hotfix de 24/11/2026: o vídeo da Hashtag Search da Meta não traz a conta dona nem as views (`videos.semDono = true`, `contaId` nulo, 0 views): só serve de sinal de assunto.
 * Ele nunca aparece em Referências (lista, "Todos", contagens das pílulas) nem como "de onde veio" do roteiro (`videoPorId`); o vídeo normal do mesmo ramo continua aparecendo.
 * Contra o Postgres real, IA simulada.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";
import { contagensPorFiltroReferencias, referenciasDoNicho, todosOsVideosDoNicho, videoPorId } from "@/servicos/pesquisa";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
const ANALISE = { assunto: "marketing digital para pequenos negocios", gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", porQueFuncionou: "p", formato: "fala_para_camera" };

let ramo: number;
let normalId: number;
let semDonoId: number;

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

beforeEach(async () => {
  await db().delete(videos);
  await db().delete(contas);
  await db().update(nichos).set({ ativo: false });
  const [r] = await db().insert(nichos).values({ slug: `sem-dono-${Date.now()}`, nome: "Marcas", termos: ["marketing"] }).returning();
  ramo = r.id;
  const [c] = await db().insert(contas).values({ plataforma: "instagram", handle: "conta_normal", nichoId: ramo, origem: "coleta", taxaForaDaCurva: "0.5" }).returning({ id: contas.id });
  const base = {
    nichoId: ramo,
    publicadoEm: new Date(Date.now() - 2 * DIA_MS),
    analise: ANALISE as never,
    serveDeModelo: true,
    origem: "coleta" as const,
    idioma: "pt",
  };
  const [normal] = await db()
    .insert(videos)
    .values({ ...base, plataforma: "instagram", idExterno: "normal-1", url: "https://exemplo.invalido/normal-1", titulo: "video normal", contaId: c.id, views: 200_000, foraDaCurva: "8", velocidadeRelativa: "5" })
    .returning({ id: videos.id });
  const [semDono] = await db()
    .insert(videos)
    .values({ ...base, plataforma: "instagram", idExterno: "sem-dono-1", url: "https://exemplo.invalido/sem-dono-1", titulo: "video da hashtag", contaId: null, semDono: true, views: 0 })
    .returning({ id: videos.id });
  normalId = normal.id;
  semDonoId = semDono.id;
});

afterAll(async () => {
  await getPool().end();
});

describe("Referências sem o vídeo sem conta dona", () => {
  it('"Todos" (sem piso) lista e conta só o vídeo normal', async () => {
    const r = await todosOsVideosDoNicho(ramo, { periodoDias: 30 });
    expect(r.videos.map((v) => v.id)).toEqual([normalId]);
    expect(r.total).toBe(1);
  });

  it("o segmento curado e a página seguinte também não trazem o vídeo sem dono", async () => {
    const curado = await referenciasDoNicho(ramo, { periodoDias: 30 });
    expect(curado.videos.map((v) => v.id)).not.toContain(semDonoId);
    const pagina2 = await todosOsVideosDoNicho(ramo, { periodoDias: 30, limite: 1 }, 1);
    expect(pagina2.videos).toEqual([]);
    expect(pagina2.total).toBe(1);
  });

  it("as contagens das pílulas não incluem o vídeo sem dono", async () => {
    const c = await contagensPorFiltroReferencias(ramo, { periodoDias: 30 }, true);
    expect(c.porPlataforma.instagram).toBe(1);
    expect(c.porViewsMin.qualquer).toBe(1);
    expect(c.porPeriodo.trinta).toBe(1);
  });

  it('"de onde veio" do roteiro (`videoPorId`) não abre o vídeo sem dono, e abre o normal', async () => {
    expect(await videoPorId(semDonoId)).toBeNull();
    expect((await videoPorId(normalId))?.id).toBe(normalId);
  });
});
