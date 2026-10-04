/**
 * `scripts/reclassificar-formato.ts` contra o Postgres real (E44 PR 1): o dry run num banco com 20 vídeos analisados, sem formato, imprime quantos entram e o custo
 * estimado (metade do custo médio real de `extrairVideo`, porque o lote custa metade); vídeo que já tem formato, do caminho sem fala ou com transcrição curta
 * demais não entra. O script nunca envia nada sem `--confirmar`, e este teste só chama o plano.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, geracoesIA, lotesIa, nichos, videos } from "@/db/schema";

import { candidatosDoSetor, planejarReclassificacao } from "../../scripts/reclassificar-formato";
import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
const diasAtras = (dias: number) => new Date(Date.now() - dias * DIA_MS);
const TRANSCRICAO = "falou sobre o produto principal, contando com detalhe o que ele resolve e para quem serve.";

let nichoId: number;
let contaId: number;

async function video(id: string, extra: Partial<typeof videos.$inferInsert> = {}) {
  await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno: `reclass-formato-${id}`,
      url: `https://x/reclass-formato-${id}`,
      contaId,
      nichoId,
      views: 100,
      publicadoEm: diasAtras(10),
      analise: { assunto: "x" } as never,
      transcricao: TRANSCRICAO,
      ...extra,
    });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "reclassificar-formato-teste", nome: "Reclassificar formato teste", termos: [] }).returning();
  nichoId = nicho.id;
  const [conta] = await db().insert(contas).values({ plataforma: "youtube", handle: "@reclassificar-formato", nichoId }).returning();
  contaId = conta.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("reclassificar-formato", () => {
  it("só entra vídeo analisado, sem formato OU sem ficha, com fala e transcrição suficiente (E49 PR 2: uma rodada reclassifica os dois campos)", async () => {
    await video("elegivel");
    await video("ja-tem-formato-e-ficha", { formatoCatalogo: "lista", fichaCatalogo: "guardem" });
    // Tem o tipo mas falta a ficha: entra.
    await video("tem-formato-sem-ficha", { formatoCatalogo: "lista" });
    await video("sem-fala", { semFala: true });
    await video("curta", { transcricao: "muito curta" });
    await video("sem-analise", { analise: null });

    const candidatos = await candidatosDoSetor(nichoId, "Reclassificar formato teste", []);
    expect(candidatos).toHaveLength(2);
    await db().delete(videos).where(eq(videos.nichoId, nichoId));
  });

  it("dry run com 20 vídeos: conta os 20 e estima o custo em lote como metade do custo médio real", async () => {
    for (let i = 0; i < 20; i++) await video(`lote-${i}`);
    // O histórico real da tarefa: duas gerações de extrairVideo a US$ 0,002 e US$ 0,004 (média 0,003; em lote 0,0015 por vídeo).
    for (const custo of ["0.002", "0.004"]) {
      await db().insert(geracoesIA).values({ tarefa: "extrairVideo", versaoPrompt: "1.11.0", modelo: "teste", entradas: {}, custoUsd: custo });
    }

    const plano = await planejarReclassificacao();

    expect(plano.total).toBe(20);
    expect(plano.porSetor).toHaveLength(1);
    expect(plano.custoMedioUsd).toBeCloseTo(0.003, 6);
    expect(plano.custoEstimadoUsd).toBeCloseTo(0.03, 6);
    console.log(`dry run: ${plano.total} vídeos, custo estimado em lote US$ ${plano.custoEstimadoUsd?.toFixed(2)}`);
  });

  it("vídeo que já está num lote em andamento não entra de novo (rodar --confirmar duas vezes não gasta em dobro)", async () => {
    const antes = await planejarReclassificacao();
    const jaEnviados = antes.porSetor[0].candidatos.slice(0, 5).map((c) => c.id);
    await db().insert(lotesIa).values({ tarefa: "extrairVideo", loteIdExterno: "lote-teste-em-andamento", videoIds: jaEnviados, status: "em_andamento" });

    const depois = await planejarReclassificacao();

    expect(depois.jaEmLote).toBe(5);
    expect(depois.total).toBe(antes.total - 5);
    expect(depois.porSetor[0].candidatos.some((c) => jaEnviados.includes(c.id))).toBe(false);
  });
});
