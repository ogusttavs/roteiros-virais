/**
 * Job `descoberta-instagram` (E6 parte 3, segunda rodada, item 4) contra o
 * Postgres real: busca por hashtag no Apify, mas so cria conta ainda
 * desconhecida; conta ja coberta pela Meta e ignorada, conta conhecida mas
 * marcada `api_indisponivel_em` continua recebendo video por aqui.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/jobs/apify-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/apify-api")>();
  return { ...original, buscarInstagram: vi.fn() };
});

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";
import { buscarInstagram, type InstagramItemBruto } from "@/jobs/apify-api";
import { rodarDescobertaInstagram } from "@/jobs/descoberta-instagram";
import { ErroColeta } from "@/jobs/execucoes";
import { config } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

function itemInstagram(overrides: Partial<InstagramItemBruto> = {}): InstagramItemBruto {
  return {
    id: "1",
    shortCode: "Exemplo01",
    url: "https://www.instagram.com/reel/Exemplo01/",
    caption: "[exemplo] video achado por hashtag",
    timestamp: "2026-08-20T10:00:00.000Z",
    ownerUsername: "conta-nova-descoberta",
    ownerFullName: "Conta Nova",
    videoPlayCount: 4000,
    likesCount: 100,
    commentsCount: 5,
    ...overrides,
  };
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "descoberta-instagram-teste", nome: "Descoberta instagram teste", termos: ["limpeza"] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  vi.mocked(buscarInstagram).mockReset();
  config.coleta.metaAtivo = true;
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(contas).where(eq(contas.nichoId, nichoId));
  config.coleta.metaAtivo = false;
});

describe("rodarDescobertaInstagram", () => {
  it("sem META_ATIVO, recusa rodar (nao retentavel)", async () => {
    config.coleta.metaAtivo = false;
    await expect(rodarDescobertaInstagram()).rejects.toThrow(ErroColeta);
  });

  it("com o teto do apify zerado (apify desligado), termina ok sem chamar o ator, em vez de lancar (ajuste 4 da revisao do PR #36)", async () => {
    const tetoOriginal = config.coleta.apifyMaxResultadosDia;
    config.coleta.apifyMaxResultadosDia = 0;
    try {
      const resumo = await rodarDescobertaInstagram();
      expect(resumo.apifyDesligado).toBe(true);
      expect(resumo.tetoAtingido).toBe(false);
      expect(resumo.termosBuscados).toBe(0);
      expect(buscarInstagram).not.toHaveBeenCalled();
    } finally {
      config.coleta.apifyMaxResultadosDia = tetoOriginal;
    }
  });

  it("busca 30 por termo e cria conta ainda desconhecida com o video que veio junto", async () => {
    vi.mocked(buscarInstagram).mockResolvedValue({ itens: [itemInstagram()], devolvidos: 1 });

    const resumo = await rodarDescobertaInstagram();

    expect(buscarInstagram).toHaveBeenCalledWith(["limpeza"], [], 30);
    expect(resumo.contasNovas).toBe(1);
    expect(resumo.videosNovos).toBe(1);

    const [conta] = await db().select().from(contas).where(eq(contas.handle, "conta-nova-descoberta"));
    expect(conta).toBeDefined();
    expect(conta.plataforma).toBe("instagram");

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "Exemplo01"));
    expect(video.contaId).toBe(conta.id);
  });

  it("conta ja coberta pela api (sem api_indisponivel_em) e ignorada: nao grava video nem mexe na conta", async () => {
    await db()
      .insert(contas)
      .values({ plataforma: "instagram", handle: "conta-nova-descoberta", nichoId, seguidores: 999 });

    vi.mocked(buscarInstagram).mockResolvedValue({ itens: [itemInstagram()], devolvidos: 1 });

    const resumo = await rodarDescobertaInstagram();

    expect(resumo.contasNovas).toBe(0);
    expect(resumo.videosNovos).toBe(0);

    const videosGravados = await db().select().from(videos).where(eq(videos.idExterno, "Exemplo01"));
    expect(videosGravados).toHaveLength(0);

    const [conta] = await db().select().from(contas).where(eq(contas.handle, "conta-nova-descoberta"));
    expect(conta.seguidores).toBe(999);
  });

  it("conta conhecida mas marcada api_indisponivel_em continua recebendo video por aqui", async () => {
    const [conta] = await db()
      .insert(contas)
      .values({
        plataforma: "instagram",
        handle: "conta-nova-descoberta",
        nichoId,
        apiIndisponivelEm: new Date(),
      })
      .returning();

    vi.mocked(buscarInstagram).mockResolvedValue({ itens: [itemInstagram()], devolvidos: 1 });

    const resumo = await rodarDescobertaInstagram();

    expect(resumo.contasNovas).toBe(0);
    expect(resumo.videosNovos).toBe(1);

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "Exemplo01"));
    expect(video.contaId).toBe(conta.id);
  });

  it("com nichoId, roda so para aquele nicho", async () => {
    const [outroNicho] = await db()
      .insert(nichos)
      .values({ slug: "descoberta-instagram-outro", nome: "Descoberta instagram outro", termos: ["outro-termo"] })
      .returning();

    try {
      vi.mocked(buscarInstagram).mockResolvedValue({ itens: [], devolvidos: 0 });

      const resumo = await rodarDescobertaInstagram(nichoId);

      expect(resumo.nichos).toBe(1);
      expect(buscarInstagram).toHaveBeenCalledWith(["limpeza"], [], 30);
      expect(buscarInstagram).not.toHaveBeenCalledWith(["outro-termo"], [], 30);
    } finally {
      await db().delete(nichos).where(eq(nichos.id, outroNicho.id));
    }
  });
});
