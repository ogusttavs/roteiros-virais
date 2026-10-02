/**
 * `scripts/reclassificar-evidencia.ts` contra o Postgres real. Achado 5 da revisão do motor
 * (01/10/2026): o script usa `extrairVideo` (lê a transcrição) para preencher `tipoConteudo` em
 * vídeo antigo; vídeo do caminho sem fala ou com transcrição curta demais nunca deveria entrar
 * aqui, porque a transcrição não é confiável o bastante (ou nem existe de verdade) para o modelo
 * classificar o tipo de conteúdo a partir dela.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";

import { candidatosDoSetor } from "../../scripts/reclassificar-evidencia";
import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;
let contaId: number;

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

const TRANSCRICAO_LONGA = "falou sobre o produto principal, contando com detalhe o que ele resolve e para quem serve.";

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "reclassificar-evidencia-teste", nome: "Reclassificar evidencia teste", termos: [] })
    .returning();
  nichoId = nicho.id;
  const [conta] = await db().insert(contas).values({ plataforma: "youtube", handle: "@reclassificar-teste", nichoId }).returning();
  contaId = conta.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
});

describe("candidatosDoSetor", () => {
  it("video elegivel de verdade (transcricao longa, sem_fala nulo) entra", async () => {
    await db().insert(videos).values({
      plataforma: "youtube",
      idExterno: "reclass-elegivel",
      url: "https://x/reclass-elegivel",
      contaId,
      nichoId,
      views: 100,
      publicadoEm: diasAtras(10),
      analise: { assunto: "x" } as never,
      transcricao: TRANSCRICAO_LONGA,
    });

    const candidatos = await candidatosDoSetor(nichoId, "Reclassificar evidencia teste", []);

    expect(candidatos.map((c) => c.id)).toHaveLength(1);
  });

  it("video do caminho sem fala (sem_fala = true) nunca entra, mesmo com transcricao longa guardada", async () => {
    await db().insert(videos).values({
      plataforma: "youtube",
      idExterno: "reclass-sem-fala",
      url: "https://x/reclass-sem-fala",
      contaId,
      nichoId,
      views: 100,
      publicadoEm: diasAtras(10),
      analise: { assunto: "x" } as never,
      transcricao: TRANSCRICAO_LONGA,
      semFala: true,
    });

    const candidatos = await candidatosDoSetor(nichoId, "Reclassificar evidencia teste", []);

    expect(candidatos).toEqual([]);
  });

  it("transcricao curta demais (abaixo de 80 caracteres) nunca entra", async () => {
    await db().insert(videos).values({
      plataforma: "youtube",
      idExterno: "reclass-curta",
      url: "https://x/reclass-curta",
      contaId,
      nichoId,
      views: 100,
      publicadoEm: diasAtras(10),
      analise: { assunto: "x" } as never,
      transcricao: "muito curta",
    });

    const candidatos = await candidatosDoSetor(nichoId, "Reclassificar evidencia teste", []);

    expect(candidatos).toEqual([]);
  });

  it("video com sem_fala falso (o caminho normal, de sempre) continua entrando", async () => {
    await db().insert(videos).values({
      plataforma: "youtube",
      idExterno: "reclass-sem-fala-falso",
      url: "https://x/reclass-sem-fala-falso",
      contaId,
      nichoId,
      views: 100,
      publicadoEm: diasAtras(10),
      analise: { assunto: "x" } as never,
      transcricao: TRANSCRICAO_LONGA,
      semFala: false,
    });

    const candidatos = await candidatosDoSetor(nichoId, "Reclassificar evidencia teste", []);

    expect(candidatos.map((c) => c.id)).toHaveLength(1);
  });
});
