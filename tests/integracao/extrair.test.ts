/**
 * `rodarExtrair` e `rodarExtrairColeta` (etapa 8): ciclo completo contra o
 * Postgres real. A API de lote roda em modo mock (`AI_PROVIDER=mock`, ja
 * garantido pelo `vitest.config.mts`), sem chamar a Anthropic de verdade;
 * o mock de `extrairVideo` ainda passa pelo schema Zod real.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { lotesIa, nichos, videos } from "@/db/schema";
import { rodarExtrair } from "@/jobs/extrair";
import { LIMITE_ANALISADOS_SETOR_NOVO } from "@/jobs/extrair-agora";
import { rodarExtrairColeta } from "@/jobs/extrair-coleta";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

const TRANSCRICAO_BOA =
  "falou sobre o produto principal, contando com detalhe o que ele resolve e para quem serve.";

const ANALISE_EXEMPLO = {
  assunto: "ja analisado",
  gancho: "x",
  estrutura: "x",
  fechamento: "x",
  chamadaFinal: "x",
  formato: "outro",
  porQueFuncionou: "x",
};

async function criarVideo(
  idExterno: string,
  opcoes: { transcricao?: string; analise?: unknown } = {},
) {
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      nichoId,
      titulo: `[exemplo] video ${idExterno}`,
      views: 100,
      transcricao: opcoes.transcricao,
      analise: opcoes.analise as never,
    })
    .returning();
  return v;
}

/**
 * M1, item 1: `rodarExtrair` agora chama `rodarExtrairAgora` antes de montar o lote, e um setor
 * com menos de `LIMITE_ANALISADOS_SETOR_NOVO` vídeos analisados vai pelo caminho imediato, não
 * pelo lote. Este arquivo testa o lote especificamente (o caminho imediato tem o próprio arquivo,
 * `extrair-agora.test.ts`), então cada teste começa com o setor já "estabelecido".
 */
async function tornarSetorEstabelecido() {
  const linhas = Array.from({ length: LIMITE_ANALISADOS_SETOR_NOVO }, (_, i) => ({
    plataforma: "youtube" as const,
    idExterno: `ja-estabelecido-${i}`,
    url: `https://exemplo.invalido/ja-estabelecido-${i}`,
    nichoId,
    titulo: `[exemplo] ja estabelecido ${i}`,
    views: 100,
    transcricao: "video ja analisado, so para o setor nao contar como novo",
    analise: ANALISE_EXEMPLO as never,
  }));
  await db().insert(videos).values(linhas);
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "extrair-teste", nome: "Extrair teste", termos: [] })
    .returning();
  nichoId = nicho.id;
});

afterAll(async () => {
  await getPool().end();
});

beforeEach(async () => {
  await tornarSetorEstabelecido();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(lotesIa);
});

describe("rodarExtrair mais rodarExtrairColeta", () => {
  it("monta o lote so com video transcrito e sem analise, e o ciclo completo grava analise mais etiquetas", async () => {
    await criarVideo("com-transcricao-sem-analise", { transcricao: TRANSCRICAO_BOA });
    await criarVideo("sem-transcricao"); // fica de fora do lote
    await criarVideo("ja-tem-analise", {
      transcricao: "outra transcricao",
      analise: { assunto: "ja analisado", gancho: "x", estrutura: "x", fechamento: "x", chamadaFinal: "x", formato: "outro", porQueFuncionou: "x" },
    }); // fica de fora do lote

    const resumoExtrair = await rodarExtrair();
    expect(resumoExtrair.videosNoLote).toBe(1);
    expect(resumoExtrair.loteIdExterno).toBeTruthy();

    const [loteGravado] = await db().select().from(lotesIa);
    expect(loteGravado.status).toBe("em_andamento");
    expect(loteGravado.tarefa).toBe("extrairVideo");

    const resumoColeta = await rodarExtrairColeta();
    expect(resumoColeta.lotesPendentesAntes).toBe(1);
    expect(resumoColeta.lotesConcluidos).toBe(1);
    expect(resumoColeta.videosAtualizados).toBe(1);

    const [videoAtualizado] = await db()
      .select()
      .from(videos)
      .where(eq(videos.idExterno, "com-transcricao-sem-analise"));
    expect(videoAtualizado.analise).not.toBeNull();
    expect(videoAtualizado.analise!.assunto).toBeTruthy();
    expect(videoAtualizado.etiquetas.length).toBeGreaterThan(0);

    const [loteAtualizado] = await db().select().from(lotesIa);
    expect(loteAtualizado.status).toBe("concluido");
    expect(loteAtualizado.concluidoEm).not.toBeNull();

    // Video que ja tinha analise nao foi tocado.
    const [videoIntocado] = await db().select().from(videos).where(eq(videos.idExterno, "ja-tem-analise"));
    expect(videoIntocado.analise!.assunto).toBe("ja analisado");
  });

  it("transcricao curta demais nao entra no lote e ganha nova tentativa de transcricao", async () => {
    await criarVideo("transcricao-curta", { transcricao: "E ai" });
    const bom = await criarVideo("transcricao-boa", { transcricao: TRANSCRICAO_BOA });

    const resumo = await rodarExtrair();
    expect(resumo.videosNoLote).toBe(1);
    expect(resumo.transcricaoCurtaDemais).toBe(1);

    const [loteGravado] = await db().select().from(lotesIa);
    expect(loteGravado.videoIds).toEqual([bom.id]);

    const [videoCurto] = await db().select().from(videos).where(eq(videos.idExterno, "transcricao-curta"));
    expect(videoCurto.proximaTentativaTranscricao).not.toBeNull();
    expect(videoCurto.analise).toBeNull();
  });

  it("sem nenhum video candidato, nao cria lote", async () => {
    const resumo = await rodarExtrair();
    expect(resumo.videosNoLote).toBe(0);
    expect(resumo.loteIdExterno).toBeUndefined();

    const lotes = await db().select().from(lotesIa);
    expect(lotes).toHaveLength(0);
  });

  it("rodar a coleta de novo depois de concluido nao reprocessa o mesmo lote", async () => {
    await criarVideo("video-unico", { transcricao: TRANSCRICAO_BOA });
    await rodarExtrair();
    await rodarExtrairColeta();

    const resumoSegunda = await rodarExtrairColeta();
    expect(resumoSegunda.lotesPendentesAntes).toBe(0);
    expect(resumoSegunda.lotesConcluidos).toBe(0);
  });
});
