/**
 * Job `pesquisa-de-setor` (M2) contra o Postgres real, com o YouTube mockado pelo `fetch` global
 * (mesmo padrão de `contas-base.test.ts`) e o TikTok/Instagram mockados sem candidato nenhum (o
 * Instagram já fica de fora sozinho, `config.coleta.metaAtivo` falso por padrão nos testes), para
 * isolar o que o item 8 pede provar: candidato inexistente é descartado, estrangeiro é descartado,
 * vídeo longo é descartado, conta tirada não volta, e um candidato bom de verdade vira semente.
 *
 * `sugerirContasDoSetor` em mock (`src/ia/mock.ts`) devolve sempre um handle de YouTube derivado
 * do nome do setor (`@<slug>-youtube`); cada teste usa um nicho com nome próprio, para nunca
 * colidir o handle de um teste com o de outro.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { consumoApi, contas, nichos, pesquisasSetor, videos } from "@/db/schema";

// eslint-disable-next-line import/order -- os imports hoisted la embaixo (depois do vi.mock) confundem a ordenacao automatica.
import { resetarSchema } from "../../scripts/resetar-schema";

vi.mock("@/jobs/apify-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/apify-api")>();
  return { ...original, buscarTiktokVigilancia: vi.fn() };
});

/**
 * A "primeira carga" (item 4) chama `rodarTranscrever` de verdade; sem mock, `baixarLegendaYoutube`
 * chama o `yt-dlp` de verdade por `execFile` (não por `fetch`, então o stub global não pega), contra
 * uma URL de vídeo que não existe. Mockado aqui porque este arquivo testa a pesquisa em si (a
 * confirmação, o filtro e a semente), não a transcrição, que já tem o próprio arquivo de teste.
 */
vi.mock("@/jobs/transcrever", () => ({ rodarTranscrever: vi.fn().mockResolvedValue({}) }));

/**
 * O cliente de IA continua o de sempre (mock por `AI_PROVIDER`), embrulhado num `vi.fn` para um
 * teste conseguir derrubar uma chamada só (hotfix de 30/09/2026: a classificação de um candidato
 * falhando não pode matar a pesquisa do setor).
 */
vi.mock("@/ia/cliente", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});

import { gerarEstruturado } from "@/ia/cliente";
import { ErroIA } from "@/ia/erro";
import { buscarTiktokVigilancia } from "@/jobs/apify-api";
import { rodarPesquisaDeSetor } from "@/jobs/pesquisa-de-setor";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function respostaJson(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
}

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): string {
  return new Date(Date.now() - dias * DIA_MS).toISOString();
}

type Canal = { id: string; country?: string; playlistId: string };
type VideoFixture = { id: string; publishedAt: string; duracaoIso: string; views: string; defaultAudioLanguage?: string; titulo: string };

/**
 * Roteia o `fetch` global pelo caminho da chamada (mesma técnica de `contas-base.test.ts`):
 * `/search` (channel ou video, item 1a) sempre vazio, para só o candidato da sugestão de IA
 * entrar; `/channels` devolve o canal cadastrado para aquele handle (ou nenhum item, "não
 * existe"); `/playlistItems` devolve os ids da fixture; `/videos` devolve os itens completos.
 */
function mockYoutube(handleParaCanal: Record<string, Canal | null>, videosPorCanal: Record<string, VideoFixture[]>) {
  mockFetch.mockImplementation(async (url: URL) => {
    const texto = url.toString();
    if (texto.includes("/search")) return respostaJson({ items: [] });
    if (texto.includes("/channels")) {
      const handle = url.searchParams.get("forHandle") ?? url.searchParams.get("id") ?? "";
      const canal = handleParaCanal[handle];
      if (!canal) return respostaJson({ items: [] });
      return respostaJson({
        items: [
          {
            id: canal.id,
            snippet: { title: `[exemplo] canal ${canal.id}`, country: canal.country },
            contentDetails: { relatedPlaylists: { uploads: canal.playlistId } },
          },
        ],
      });
    }
    if (texto.includes("/playlistItems")) {
      const playlistId = url.searchParams.get("playlistId") ?? "";
      const canalId = Object.values(handleParaCanal).find((c) => c?.playlistId === playlistId)?.id ?? "";
      const fixtures = videosPorCanal[canalId] ?? [];
      return respostaJson({
        items: fixtures.map((v) => ({ snippet: { resourceId: { videoId: v.id }, publishedAt: v.publishedAt } })),
      });
    }
    if (texto.includes("/videos")) {
      const ids = (url.searchParams.get("id") ?? "").split(",");
      const todos = Object.values(videosPorCanal).flat();
      const items = ids
        .map((id) => todos.find((v) => v.id === id))
        .filter((v): v is VideoFixture => v !== undefined)
        .map((v) => ({
          id: v.id,
          snippet: {
            channelId: "ignorado",
            channelTitle: "ignorado",
            title: v.titulo,
            description: "",
            publishedAt: v.publishedAt,
            defaultAudioLanguage: v.defaultAudioLanguage,
          },
          contentDetails: { duration: v.duracaoIso },
          statistics: { viewCount: v.views },
        }));
      return respostaJson({ items });
    }
    throw new Error(`chamada inesperada nesta fixture: ${texto}`);
  });
}

/** Cinco vídeos curtos, brasileiros, recentes e com views acima do piso de alcance: passa em todo o filtro de código. */
function videosBonsPadrao(canalId: string): VideoFixture[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `${canalId}-v${i}`,
    publishedAt: diasAtras(3),
    duracaoIso: "PT45S",
    views: "10000",
    defaultAudioLanguage: "pt-BR",
    titulo: "dica de limpeza para o dia a dia",
  }));
}

async function criarNicho(nome: string): Promise<number> {
  const slug = nome
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const [nicho] = await db().insert(nichos).values({ slug, nome, termos: ["limpeza"], ativo: true }).returning();
  return nicho.id;
}

/** O handle de YouTube que o mock de `sugerirContasDoSetor` deriva do nome do setor. */
function handleSugerido(nome: string): string {
  const slug = nome
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `@${slug}-youtube`;
}

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

beforeEach(() => {
  vi.mocked(buscarTiktokVigilancia).mockResolvedValue({ itens: [], devolvidos: 0 });
  vi.mocked(gerarEstruturado).mockClear();
  mockFetch.mockReset();
});

afterEach(async () => {
  await db().delete(videos);
  await db().delete(contas);
  await db().delete(pesquisasSetor);
  await db().delete(consumoApi);
  await db().delete(nichos);
});

afterAll(async () => {
  await getPool().end();
});

describe("rodarPesquisaDeSetor", () => {
  it("candidato sugerido que nao existe na API e descartado, nenhuma conta e criada", async () => {
    const nichoId = await criarNicho("Pesquisa Setor Inexistente");
    mockYoutube({}, {}); // nenhum canal cadastrado: buscarCanal sempre devolve items vazio.

    const resumo = await rodarPesquisaDeSetor(nichoId);

    expect((resumo as { confirmadas: { youtube: number } }).confirmadas.youtube).toBe(0);
    expect((resumo as { descartadas: Record<string, number> }).descartadas.sugerido_e_nao_existe).toBeGreaterThanOrEqual(1);
    const contasCriadas = await db().select().from(contas).where(eq(contas.nichoId, nichoId));
    expect(contasCriadas).toHaveLength(0);
  }, 30_000);

  it("candidato estrangeiro (pais e idioma nao brasileiros) e descartado", async () => {
    const nome = "Pesquisa Setor Estrangeiro";
    const nichoId = await criarNicho(nome);
    const handle = handleSugerido(nome);
    const canal: Canal = { id: "canal-estrangeiro", country: "US", playlistId: "UUestrangeiro" };
    const videosFixture = Array.from({ length: 5 }, (_, i) => ({
      id: `canal-estrangeiro-v${i}`,
      publishedAt: diasAtras(3),
      duracaoIso: "PT45S",
      views: "10000",
      defaultAudioLanguage: "en",
      titulo: "cleaning tips for your home",
    }));
    mockYoutube({ [handle]: canal }, { "canal-estrangeiro": videosFixture });

    const resumo = await rodarPesquisaDeSetor(nichoId);

    expect((resumo as { confirmadas: { youtube: number } }).confirmadas.youtube).toBe(0);
    expect((resumo as { descartadas: Record<string, number> }).descartadas.nao_brasileiro).toBeGreaterThanOrEqual(1);
    const contasCriadas = await db().select().from(contas).where(eq(contas.nichoId, nichoId));
    expect(contasCriadas).toHaveLength(0);
  }, 30_000);

  it("candidato so com video longo (menos de 5 dos ultimos 20 dentro do teto de duracao) e descartado", async () => {
    const nome = "Pesquisa Setor Video Longo";
    const nichoId = await criarNicho(nome);
    const handle = handleSugerido(nome);
    const canal: Canal = { id: "canal-longo", country: "BR", playlistId: "UUlongo" };
    const videosFixture = Array.from({ length: 5 }, (_, i) => ({
      id: `canal-longo-v${i}`,
      publishedAt: diasAtras(3),
      // Bem acima do teto de 180s (hotfix #72): nenhum vídeo passa no "pelo menos 5 de 20 curtos".
      duracaoIso: "PT10M0S",
      views: "10000",
      defaultAudioLanguage: "pt-BR",
      titulo: "dica de limpeza para o dia a dia",
    }));
    mockYoutube({ [handle]: canal }, { "canal-longo": videosFixture });

    const resumo = await rodarPesquisaDeSetor(nichoId);

    expect((resumo as { confirmadas: { youtube: number } }).confirmadas.youtube).toBe(0);
    expect((resumo as { descartadas: Record<string, number> }).descartadas.video_longo_demais).toBeGreaterThanOrEqual(1);
    const contasCriadas = await db().select().from(contas).where(eq(contas.nichoId, nichoId));
    expect(contasCriadas).toHaveLength(0);
  }, 30_000);

  it("conta ja tirada (removida_em preenchido) nunca volta a ser proposta pela pesquisa", async () => {
    const nome = "Pesquisa Setor Conta Tirada";
    const nichoId = await criarNicho(nome);
    const handle = handleSugerido(nome);
    const canal: Canal = { id: "canal-tirado", country: "BR", playlistId: "UUtirado" };
    mockYoutube({ [handle]: canal }, { "canal-tirado": videosBonsPadrao("canal-tirado") });

    // A conta ja existia, foi semente de pesquisa antes, e o admin "tirou" ela (M2, item 3).
    await db()
      .insert(contas)
      .values({ plataforma: "youtube", handle: canal.id, nichoId, origem: "pesquisa", removidaEm: new Date() });

    const resumo = await rodarPesquisaDeSetor(nichoId);

    expect((resumo as { confirmadas: { youtube: number } }).confirmadas.youtube).toBe(0);
    expect((resumo as { descartadas: Record<string, number> }).descartadas.sugerido_e_nao_existe).toBeGreaterThanOrEqual(1);
    // A chamada que traria os vídeos (playlistItems) nunca deveria ter sido tentada para esta conta.
    const chamouUploads = mockFetch.mock.calls.some((chamada) => (chamada[0] as URL).toString().includes("/playlistItems"));
    expect(chamouUploads).toBe(false);
  }, 30_000);

  it("candidato brasileiro, ativo, com alcance e do setor vira conta semente (origem pesquisa, vigiada)", async () => {
    const nome = "Pesquisa Setor Bom";
    const nichoId = await criarNicho(nome);
    const handle = handleSugerido(nome);
    const canal: Canal = { id: "canal-bom", country: "BR", playlistId: "UUbom" };
    mockYoutube({ [handle]: canal }, { "canal-bom": videosBonsPadrao("canal-bom") });

    const resumo = await rodarPesquisaDeSetor(nichoId);

    expect((resumo as { confirmadas: { youtube: number } }).confirmadas.youtube).toBe(1);
    expect((resumo as { contasNovas: number }).contasNovas).toBe(1);

    const [conta] = await db()
      .select()
      .from(contas)
      .where(and(eq(contas.nichoId, nichoId), eq(contas.handle, "canal-bom")));
    expect(conta.origem).toBe("pesquisa");
    expect(conta.vigiada).toBe(true);

    const videosGravados = await db().select().from(videos).where(eq(videos.contaId, conta.id));
    expect(videosGravados).toHaveLength(5);

    const [linhaPesquisa] = await db().select().from(pesquisasSetor).where(eq(pesquisasSetor.nichoId, nichoId));
    expect(linhaPesquisa).toBeDefined();
    expect(linhaPesquisa.resumo.contasNovas).toBe(1);
  }, 30_000);

  it("classificacao por IA de um candidato falhando vira descarte contado, a rodada segue e grava o resumo (hotfix de 30/09)", async () => {
    const nome = "Pesquisa Setor Erro IA";
    const nichoId = await criarNicho(nome);
    const handle = handleSugerido(nome);
    const canal: Canal = { id: "canal-erro-ia", country: "BR", playlistId: "UUerroia" };
    mockYoutube({ [handle]: canal }, { "canal-erro-ia": videosBonsPadrao("canal-erro-ia") });

    const original = vi.mocked(gerarEstruturado).getMockImplementation()!;
    vi.mocked(gerarEstruturado).mockImplementation(async (params) => {
      if (params.tarefa === "classificarContaDoSetor") throw new ErroIA('erro da API (400) na tarefa "classificarContaDoSetor"');
      return original(params);
    });
    try {
      const resumo = (await rodarPesquisaDeSetor(nichoId)) as { contasNovas: number; descartadas: Record<string, number> };

      expect(resumo.contasNovas).toBe(0);
      expect(resumo.descartadas.erro_na_classificacao).toBe(1);
      const contasDoNicho = await db().select().from(contas).where(eq(contas.nichoId, nichoId));
      expect(contasDoNicho).toHaveLength(0);
      const [linhaPesquisa] = await db().select().from(pesquisasSetor).where(eq(pesquisasSetor.nichoId, nichoId));
      expect(linhaPesquisa).toBeDefined();
    } finally {
      vi.mocked(gerarEstruturado).mockImplementation(original);
    }
  }, 30_000);

  it("conta que ja e curadoria nunca e rebaixada, mesmo sendo achada de novo pela pesquisa", async () => {
    const nome = "Pesquisa Setor Curadoria";
    const nichoId = await criarNicho(nome);
    const handle = handleSugerido(nome);
    const canal: Canal = { id: "canal-curadoria", country: "BR", playlistId: "UUcuradoria" };
    mockYoutube({ [handle]: canal }, { "canal-curadoria": videosBonsPadrao("canal-curadoria") });

    await db().insert(contas).values({ plataforma: "youtube", handle: canal.id, nichoId, origem: "curadoria", vigiada: true });

    await rodarPesquisaDeSetor(nichoId);

    const [conta] = await db()
      .select()
      .from(contas)
      .where(and(eq(contas.nichoId, nichoId), eq(contas.handle, "canal-curadoria")));
    expect(conta.origem).toBe("curadoria");
    expect(conta.vigiada).toBe(true);
  }, 30_000);
});
