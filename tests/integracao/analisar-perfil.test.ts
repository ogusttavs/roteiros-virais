/**
 * Job `analisar-perfil` (E38, partes 2 e 3) contra o Postgres real, com o YouTube mockado pelo
 * `fetch` global (mesmo padrão de `pesquisa-de-setor.test.ts`): confere um perfil citado ou da
 * própria marca, grava a leitura curta e, quando o cliente tem setor, classifica se o perfil
 * qualifica como candidato a conta do setor. `virarContaDoSetor` é a promoção manual (parte 3).
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { clientes, contas, nichos, perfisAnalisados, user, videos } from "@/db/schema";
import { rodarAnalisarPerfil, TETO_VIDEOS_LEITURA, virarContaDoSetor, type PayloadAnalisarPerfil } from "@/jobs/analisar-perfil";

import { resetarSchema } from "../../scripts/resetar-schema";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

type Canal = { id: string; country?: string; playlistId: string; respostaUploadsComErro?: string };
type VideoFixture = { id: string; publicadoHaDias?: number; duracaoS?: number; views?: string; idioma?: string; titulo: string };

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): string {
  return new Date(Date.now() - dias * DIA_MS).toISOString();
}

/** Cinco vídeos curtos, brasileiros, recentes e com views acima do piso: passam no filtro de código. */
function videosBonsPadrao(prefixo: string, quantidade = 5): VideoFixture[] {
  return Array.from({ length: quantidade }, (_, i) => ({
    id: `${prefixo}-v${i}`,
    titulo: "dica de limpeza para o dia a dia",
  }));
}

function mockYoutube(handleParaCanal: Record<string, Canal | null>, videosPorCanal: Record<string, VideoFixture[]>) {
  mockFetch.mockImplementation(async (url: URL) => {
    const texto = url.toString();
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
      const canal = Object.values(handleParaCanal).find((c) => c?.playlistId === playlistId);
      if (canal?.respostaUploadsComErro) return new Response(canal.respostaUploadsComErro, { status: 404 });
      const fixtures = videosPorCanal[canal?.id ?? ""] ?? [];
      return respostaJson({
        items: fixtures.map((v) => ({ snippet: { resourceId: { videoId: v.id }, publishedAt: diasAtras(v.publicadoHaDias ?? 3) } })),
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
            publishedAt: diasAtras(v.publicadoHaDias ?? 3),
            defaultAudioLanguage: v.idioma ?? "pt-BR",
          },
          contentDetails: { duration: `PT${v.duracaoS ?? 45}S` },
          statistics: { viewCount: v.views ?? "10000" },
        }));
      return respostaJson({ items });
    }
    throw new Error(`chamada inesperada nesta fixture: ${texto}`);
  });
}

async function criarClienteComNicho(prefixo: string, nichoId: number | null): Promise<number> {
  const [usuario] = await db()
    .insert(user)
    .values({ id: `${prefixo}-usuario`, name: `[teste] ${prefixo}`, email: `${prefixo}@analisar-perfil.teste` })
    .returning();
  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId: usuario.id, nome: `[teste] ${prefixo}`, nichoId })
    .returning();
  return cliente.id;
}

function payload(clienteId: number, handle: string, extra: Partial<PayloadAnalisarPerfil> = {}): PayloadAnalisarPerfil {
  return { clienteId, perfilCitadoId: null, origem: "propria_marca", tipoCitado: null, rede: "youtube", handle, ...extra };
}

async function linhaAnalisada(clienteId: number, handle: string) {
  const [linha] = await db()
    .select()
    .from(perfisAnalisados)
    .where(and(eq(perfisAnalisados.clienteId, clienteId), eq(perfisAnalisados.handle, handle)));
  return linha;
}

let nichoLimpezaId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "analisar-perfil-limpeza", nome: "Limpeza", termos: ["limpeza"], ativo: true }).returning();
  nichoLimpezaId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("rodarAnalisarPerfil, TikTok (Apify suspenso)", () => {
  it("nao chama a API, grava existeNaRede falso com o motivo", async () => {
    const clienteId = await criarClienteComNicho("tiktok-suspenso", null);
    mockFetch.mockClear();

    const resultado = await rodarAnalisarPerfil(payload(clienteId, "perfiltiktok", { rede: "tiktok" }));

    expect(resultado.pulado).toBe("tiktok_suspenso");
    expect(mockFetch).not.toHaveBeenCalled();
    const linha = await linhaAnalisada(clienteId, "perfiltiktok");
    expect(linha?.existeNaRede).toBe(false);
    expect(linha?.erro).toContain("Apify suspenso");
  });
});

describe("rodarAnalisarPerfil, YouTube", () => {
  it("perfil nao existe na rede: grava existeNaRede falso", async () => {
    const clienteId = await criarClienteComNicho("nao-encontrado", null);
    mockYoutube({}, {});

    const resultado = await rodarAnalisarPerfil(payload(clienteId, "@naoexiste"));

    expect(resultado.descartado).toBe("nao_encontrado");
    const linha = await linhaAnalisada(clienteId, "@naoexiste");
    expect(linha?.existeNaRede).toBe(false);
    expect(linha?.erro).toContain("nao encontrado na rede.");
  });

  it("o canal nao tem playlist de uploads (ErroYoutubeApi com playlistNotFound): descartado como sem_videos", async () => {
    const clienteId = await criarClienteComNicho("sem-videos", null);
    mockYoutube(
      { "@semvideos": { id: "canal-sem-videos", country: "BR", playlistId: "pl-sem-videos", respostaUploadsComErro: "playlistNotFound: nao existe" } },
      {},
    );

    const resultado = await rodarAnalisarPerfil(payload(clienteId, "@semvideos"));

    expect(resultado.descartado).toBe("sem_videos");
    const linha = await linhaAnalisada(clienteId, "@semvideos");
    expect(linha?.existeNaRede).toBe(false);
  });

  it("cliente sem setor: grava a leitura, nunca classifica (qualificaParaSetor falso)", async () => {
    const clienteId = await criarClienteComNicho("sem-setor", null);
    mockYoutube(
      { "@semsetor": { id: "canal-sem-setor", country: "BR", playlistId: "pl-sem-setor" } },
      { "canal-sem-setor": videosBonsPadrao("sem-setor") },
    );

    const resultado = await rodarAnalisarPerfil(payload(clienteId, "@semsetor"));

    expect(resultado.qualificaParaSetor).toBe(false);
    const linha = await linhaAnalisada(clienteId, "@semsetor");
    expect(linha?.existeNaRede).toBe(true);
    expect(linha?.leitura).toBeTruthy();
    expect(linha?.qualificaParaSetor).toBe(false);
  });

  it("cliente com setor, titulos citam o termo do setor: qualifica", async () => {
    const clienteId = await criarClienteComNicho("qualifica", nichoLimpezaId);
    mockYoutube(
      { "@qualifica": { id: "canal-qualifica", country: "BR", playlistId: "pl-qualifica" } },
      { "canal-qualifica": videosBonsPadrao("qualifica") },
    );

    const resultado = await rodarAnalisarPerfil(payload(clienteId, "@qualifica"));

    expect(resultado.qualificaParaSetor).toBe(true);
    const linha = await linhaAnalisada(clienteId, "@qualifica");
    expect(linha?.qualificaParaSetor).toBe(true);
  });

  it("cliente com setor, mas nenhum video tem titulo ou legenda: nao qualifica (nada para classificar)", async () => {
    const clienteId = await criarClienteComNicho("nao-qualifica", nichoLimpezaId);
    mockYoutube(
      { "@naoqualifica": { id: "canal-nao-qualifica", country: "BR", playlistId: "pl-nao-qualifica" } },
      { "canal-nao-qualifica": videosBonsPadrao("nao-qualifica").map((v) => ({ ...v, titulo: "" })) },
    );

    const resultado = await rodarAnalisarPerfil(payload(clienteId, "@naoqualifica"));

    expect(resultado.qualificaParaSetor).toBe(false);
  });

  it('o "teto pequeno por conta" corta em 10, mesmo com mais videos confirmados', async () => {
    const clienteId = await criarClienteComNicho("teto", null);
    mockYoutube(
      { "@teto": { id: "canal-teto", country: "BR", playlistId: "pl-teto" } },
      { "canal-teto": videosBonsPadrao("teto", 15) },
    );

    const resultado = await rodarAnalisarPerfil(payload(clienteId, "@teto"));

    expect(resultado.contagemVideosLidos).toBe(TETO_VIDEOS_LEITURA);
    const linha = await linhaAnalisada(clienteId, "@teto");
    expect(linha?.contagemVideosLidos).toBe(TETO_VIDEOS_LEITURA);
  });

  it("rodar duas vezes para o mesmo cliente/rede/handle atualiza a linha em vez de duplicar", async () => {
    const clienteId = await criarClienteComNicho("upsert", null);
    mockYoutube(
      { "@upsert": { id: "canal-upsert", country: "BR", playlistId: "pl-upsert" } },
      { "canal-upsert": videosBonsPadrao("upsert") },
    );

    await rodarAnalisarPerfil(payload(clienteId, "@upsert"));
    await rodarAnalisarPerfil(payload(clienteId, "@upsert"));

    const linhas = await db()
      .select()
      .from(perfisAnalisados)
      .where(and(eq(perfisAnalisados.clienteId, clienteId), eq(perfisAnalisados.handle, "@upsert")));
    expect(linhas).toHaveLength(1);
  });

  it("isolado por cliente: a leitura de um cliente nao aparece para outro", async () => {
    const clienteA = await criarClienteComNicho("isolado-a", null);
    const clienteB = await criarClienteComNicho("isolado-b", null);
    mockYoutube(
      { "@isolado": { id: "canal-isolado", country: "BR", playlistId: "pl-isolado" } },
      { "canal-isolado": videosBonsPadrao("isolado") },
    );

    await rodarAnalisarPerfil(payload(clienteA, "@isolado"));

    const linhaB = await linhaAnalisada(clienteB, "@isolado");
    expect(linhaB).toBeUndefined();
  });
});

describe("isolamento (pedido do Fable na revisao do contraponto)", () => {
  it("mesmo um perfil que qualifica nunca escreve em contas/videos antes da promocao manual: Referencias, tema e evidencia de outra marca nunca veem esse video", async () => {
    const clienteId = await criarClienteComNicho("isolamento-contas-videos", nichoLimpezaId);
    mockYoutube(
      { "@isolamentocv": { id: "canal-isolamento-cv", country: "BR", playlistId: "pl-isolamento-cv" } },
      { "canal-isolamento-cv": videosBonsPadrao("isolamento-cv") },
    );

    const resultado = await rodarAnalisarPerfil(payload(clienteId, "@isolamentocv"));
    expect(resultado.qualificaParaSetor).toBe(true);

    const contasComEsseHandle = await db().select().from(contas).where(eq(contas.handle, "canal-isolamento-cv"));
    expect(contasComEsseHandle).toHaveLength(0);
    const videosComEssePrefixo = await db().select().from(videos).where(eq(videos.idExterno, "isolamento-cv-v0"));
    expect(videosComEssePrefixo).toHaveLength(0);
  });
});

describe("virarContaDoSetor", () => {
  it("recusa perfil que nao existe", async () => {
    await expect(virarContaDoSetor(999_999)).rejects.toThrow("perfil analisado nao encontrado");
  });

  it("recusa perfil que nao qualificou", async () => {
    // Sem setor, rodarAnalisarPerfil nunca classifica: qualificaParaSetor fica falso por padrao.
    const clienteId = await criarClienteComNicho("vira-nao-qualificado", null);
    mockYoutube(
      { "@viranaoqualificado": { id: "canal-vira-nao-qualificado", country: "BR", playlistId: "pl-vira-nao-qualificado" } },
      { "canal-vira-nao-qualificado": videosBonsPadrao("vira-nao-qualificado") },
    );
    await rodarAnalisarPerfil(payload(clienteId, "@viranaoqualificado"));
    const linha = await linhaAnalisada(clienteId, "@viranaoqualificado");

    await expect(virarContaDoSetor(linha!.id)).rejects.toThrow("nao passou na regua do setor");
  });

  it("recusa cliente sem setor", async () => {
    const clienteId = await criarClienteComNicho("vira-sem-setor", null);
    mockYoutube(
      { "@virasemsetor": { id: "canal-vira-sem-setor", country: "BR", playlistId: "pl-vira-sem-setor" } },
      { "canal-vira-sem-setor": videosBonsPadrao("vira-sem-setor") },
    );
    await rodarAnalisarPerfil(payload(clienteId, "@virasemsetor"));
    await db().update(perfisAnalisados).set({ qualificaParaSetor: true }).where(and(eq(perfisAnalisados.clienteId, clienteId), eq(perfisAnalisados.handle, "@virasemsetor")));
    const linha = await linhaAnalisada(clienteId, "@virasemsetor");

    await expect(virarContaDoSetor(linha!.id)).rejects.toThrow("nao tem um setor");
  });

  it("promove: cria a conta vigiada do setor com origem indicada, grava os videos, marca viraDoSetorEm", async () => {
    const clienteId = await criarClienteComNicho("vira-ok", nichoLimpezaId);
    mockYoutube(
      { "@viraok": { id: "canal-vira-ok", country: "BR", playlistId: "pl-vira-ok" } },
      { "canal-vira-ok": videosBonsPadrao("vira-ok") },
    );
    await rodarAnalisarPerfil(payload(clienteId, "@viraok"));
    const linhaAntes = await linhaAnalisada(clienteId, "@viraok");
    expect(linhaAntes?.qualificaParaSetor).toBe(true);
    expect(linhaAntes?.viraDoSetorEm).toBeNull();

    const { contaId } = await virarContaDoSetor(linhaAntes!.id);

    const [conta] = await db().select().from(contas).where(eq(contas.id, contaId));
    expect(conta.origem).toBe("indicada");
    expect(conta.vigiada).toBe(true);
    expect(conta.nichoId).toBe(nichoLimpezaId);

    const videosDaConta = await db().select().from(videos).where(eq(videos.contaId, contaId));
    expect(videosDaConta.length).toBeGreaterThan(0);

    const linhaDepois = await linhaAnalisada(clienteId, "@viraok");
    expect(linhaDepois?.viraDoSetorEm).not.toBeNull();
  });
});
