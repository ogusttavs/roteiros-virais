/**
 * Checagem de idioma em `rodarExtrairColeta` (acabamento visual 2, achado
 * do Gustavo no iPad: duas analises reais saem em ingles ou so com o
 * gancho no idioma original). Contra o Postgres real; a primeira tentativa
 * vem do lote em mock (`AI_PROVIDER=mock`), determinístico a partir do
 * titulo do video (`src/ia/mock.ts`, `mockExtrairVideo`).
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/ia/cliente", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});

import { db, getPool } from "@/db";
import { lotesIa, nichos, videos } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { rodarExtrair } from "@/jobs/extrair";
import { LIMITE_ANALISADOS_SETOR_NOVO } from "@/jobs/extrair-agora";
import { rodarExtrairColeta } from "@/jobs/extrair-coleta";

import { resetarSchema } from "../../scripts/resetar-schema";

const gerarEstruturadoMock = vi.mocked(gerarEstruturado);

let nichoId: number;

async function criarVideo(
  idExterno: string,
  titulo: string,
  opcoes: { idioma?: string | null; idiomaConfirmado?: boolean } = {},
) {
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
      idioma: opcoes.idioma,
      idiomaConfirmado: opcoes.idiomaConfirmado,
    })
    .returning();
  return v;
}

/**
 * M1, item 1: `rodarExtrair` chama `rodarExtrairAgora` antes do lote, e setor com menos de
 * `LIMITE_ANALISADOS_SETOR_NOVO` vídeos analisados vai pelo caminho imediato, não pelo lote.
 * Este arquivo testa a checagem de idioma do lote especificamente, então cada teste começa com
 * o setor já "estabelecido" (os vídeos aqui já nascem com `analise`, fora da consulta do
 * caminho imediato, que só olha `analise is null`).
 */
async function tornarSetorEstabelecido() {
  const analiseExemplo = {
    assunto: "ja analisado",
    gancho: "x",
    estrutura: "x",
    fechamento: "x",
    chamadaFinal: "x",
    formato: "outro" as const,
    porQueFuncionou: "x",
  };
  const linhas = Array.from({ length: LIMITE_ANALISADOS_SETOR_NOVO }, (_, i) => ({
    plataforma: "youtube" as const,
    idExterno: `ja-estabelecido-${i}`,
    url: `https://exemplo.invalido/ja-estabelecido-${i}`,
    nichoId,
    titulo: `[exemplo] ja estabelecido ${i}`,
    views: 100,
    transcricao: "video ja analisado, so para o setor nao contar como novo",
    analise: analiseExemplo as never,
  }));
  await db().insert(videos).values(linhas);
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

beforeEach(async () => {
  await tornarSetorEstabelecido();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(lotesIa);
  gerarEstruturadoMock.mockClear();
});

describe("rodarExtrairColeta, checagem de idioma", () => {
  it("reprovada nas duas tentativas: grava a melhor das duas mesmo assim, nunca fica sem analise", async () => {
    await criarVideo("video-em-ingles", "how to clean a couch fast without buying anything");

    await rodarExtrair();
    const resumo = await rodarExtrairColeta();

    // revisao do PR #30: analise nenhuma e pior que uma com um campo em ingles.
    expect(resumo.videosAtualizados).toBe(1);
    expect(resumo.reprovadosPorIdioma).toBe(1);

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "video-em-ingles"));
    expect(video.analise).not.toBeNull();
    // mock e deterministico a partir do titulo: a retentativa repete o mesmo gancho em ingles,
    // empate na contagem de campos em portugues, entao fica com a analise original.
    expect(video.analise!.gancho).toBe("abertura sobre how to clean a couch fast without buying anything");
    // V4, item 5: tipoAbertura sobrescreve a coluna propria, fora do jsonb analise (mesmo caminho de idioma).
    expect(video.tipoAbertura).toBe("outro");

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
        idioma: "pt-BR",
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

/**
 * Achado 3 da revisao do motor (01/10/2026): `idiomaConfirmado` (a Groq ou a legenda do YouTube
 * confirmaram o idioma na fala de verdade, `transcrever.ts`) impede a extracao de trocar para uma
 * lingua base diferente, mas continua deixando ela refinar dentro da mesma (o mock de
 * `extrairVideo` sempre devolve "pt-BR", `src/ia/mock.ts`).
 */
describe("aplicarResultadoExtracao, achado 3: idioma confirmado nao e sobrescrito por lingua diferente", () => {
  it("idioma confirmado 'en': a extracao (mock sempre 'pt-BR') nao sobrescreve, o idioma continua 'en'", async () => {
    await criarVideo("video-idioma-confirmado-en", "assunto qualquer", { idioma: "en", idiomaConfirmado: true });

    await rodarExtrair();
    await rodarExtrairColeta();

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "video-idioma-confirmado-en"));
    expect(video.idioma).toBe("en");
    expect(video.analise).not.toBeNull(); // a analise em si grava normalmente, so o idioma fica protegido.
  });

  it("idioma confirmado 'pt' generico: a extracao pode refinar para 'pt-BR' (mesma lingua base)", async () => {
    await criarVideo("video-idioma-confirmado-pt", "assunto qualquer", { idioma: "pt", idiomaConfirmado: true });

    await rodarExtrair();
    await rodarExtrairColeta();

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "video-idioma-confirmado-pt"));
    expect(video.idioma).toBe("pt-BR");
  });

  it("sem idioma confirmado (o caso de sempre): a extracao grava o proprio palpite normalmente", async () => {
    await criarVideo("video-idioma-nao-confirmado", "assunto qualquer", { idioma: "en", idiomaConfirmado: false });

    await rodarExtrair();
    await rodarExtrairColeta();

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "video-idioma-nao-confirmado"));
    expect(video.idioma).toBe("pt-BR");
  });
});
