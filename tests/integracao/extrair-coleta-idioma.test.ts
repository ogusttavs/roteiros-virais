/**
 * Checagem de idioma em `rodarExtrairColeta` (acabamento visual 2, achado
 * do Gustavo no iPad: duas analises reais saem em ingles ou so com o
 * gancho no idioma original). Contra o Postgres real; a primeira tentativa
 * vem do lote em mock (`AI_PROVIDER=mock`), determinístico a partir do
 * titulo do video (`src/ia/mock.ts`, `mockExtrairVideo`).
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/ia/cliente", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});

import { db, getPool } from "@/db";
import { lotesIa, nichos, videos } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { rodarExtrair } from "@/jobs/extrair";
import { rodarExtrairColeta } from "@/jobs/extrair-coleta";

import { resetarSchema } from "../../scripts/resetar-schema";

const gerarEstruturadoMock = vi.mocked(gerarEstruturado);

let nichoId: number;

async function criarVideo(idExterno: string, titulo: string) {
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      nichoId,
      titulo,
      views: 100,
      transcricao: "falou sobre o produto principal, contando com detalhe o que ele resolve e para quem serve.",
    })
    .returning();
  return v;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "extrair-idioma-teste", nome: "Extrair idioma teste", termos: [] })
    .returning();
  nichoId = nicho.id;
});

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(lotesIa);
  gerarEstruturadoMock.mockClear();
});

describe("rodarExtrairColeta, checagem de idioma", () => {
  it("reprovada nas duas tentativas: o video fica sem analise e o resumo conta", async () => {
    await criarVideo("video-em-ingles", "how to clean a couch fast without buying anything");

    await rodarExtrair();
    const resumo = await rodarExtrairColeta();

    expect(resumo.videosAtualizados).toBe(0);
    expect(resumo.reprovadosPorIdioma).toBe(1);

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "video-em-ingles"));
    expect(video.analise).toBeNull();

    // uma chamada de retentativa so, alem da do lote (que nao passa por gerarEstruturado).
    expect(gerarEstruturadoMock).toHaveBeenCalledTimes(1);
  });

  it("usa o resultado da segunda tentativa quando ela vem certa em portugues", async () => {
    await criarVideo("video-corrigido-na-segunda", "how to clean a couch fast without buying anything");

    gerarEstruturadoMock.mockResolvedValueOnce({
      dados: {
        assunto: "como tirar mancha do sofa",
        gancho: "voce nunca fez isso com o seu sofa antes",
        estrutura: "gancho, explicacao, demonstracao, fechamento",
        fechamento: "mostra o resultado final para quem esta assistindo",
        chamadaFinal: "comenta se voce ja passou por isso",
        formato: "fala_para_camera",
        porQueFuncionou: "mostra o problema acontecendo de verdade para quem precisa",
        etiquetas: ["sofa", "mancha"],
        pertenceAoNicho: true,
        motivoNicho: "fala do assunto do nicho",
      },
      modelo: "mock-corrigido",
      tokensEntrada: 10,
      tokensSaida: 20,
      tokensCacheLeitura: 0,
      tokensCacheEscrita: 0,
    });

    await rodarExtrair();
    const resumo = await rodarExtrairColeta();

    expect(resumo.videosAtualizados).toBe(1);
    expect(resumo.reprovadosPorIdioma).toBe(0);

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "video-corrigido-na-segunda"));
    expect(video.analise?.gancho).toBe("voce nunca fez isso com o seu sofa antes");
  });
});
