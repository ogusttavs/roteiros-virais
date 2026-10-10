/**
 * Ciclo completo da coleta de noticias contra o Postgres real, com o RSS
 * mockado (etapa 6, criterio de aceite): busca por termo, normaliza, grava,
 * e idempotencia por `noticias.url` (rodar duas vezes atualiza em vez de
 * duplicar).
 */
import { eq } from "drizzle-orm";
import Parser from "rss-parser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FONTES_DE_NOTICIAS } from "@/config/fontes-noticias";
import { db, getPool } from "@/db";
import { nichos, noticias } from "@/db/schema";
import { rodarColetaNoticias, type DependenciasDaColeta } from "@/jobs/coleta-noticias";

import { resetarSchema } from "../../scripts/resetar-schema";

/**
 * O vitest levanta (hoisting) todo `vi.mock` para o topo do arquivo, antes
 * de qualquer import, mesmo escrito depois deles aqui; nao precisa vir antes
 * do `import Parser` para funcionar.
 */
vi.mock("rss-parser", () => {
  const parseURL = vi.fn();
  return {
    default: vi.fn().mockImplementation(function ParserFalso(this: { parseURL: typeof parseURL }) {
      this.parseURL = parseURL;
    }),
  };
});

const parseURL = (new Parser() as unknown as { parseURL: ReturnType<typeof vi.fn> }).parseURL;

let nichoId: number;

/**
 * A rodada de todos os setores também lê os feeds dos portais curados (os assuntos e a foto do setor): o teste nunca vai à internet. O `baixar` daqui registra o endereço e responde que o feed
 * está fora do ar (o job continua e só anota a falha); o `buscarPagina` registra e não acha foto. Quem quiser provar que a rede NÃO foi tocada confere as duas listas vazias.
 */
const baixados: string[] = [];
const paginasLidas: string[] = [];
const SEM_REDE: DependenciasDaColeta = {
  baixar: async (url) => {
    baixados.push(url);
    throw new Error("sem rede nos testes");
  },
  buscarPagina: async (url) => {
    paginasLidas.push(url);
    return null;
  },
};

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "coleta-noticias-teste", nome: "Coleta noticias teste", termos: ["dentista"] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  parseURL.mockReset();
  baixados.length = 0;
  paginasLidas.length = 0;
});

afterEach(async () => {
  await db().delete(noticias).where(eq(noticias.nichoId, nichoId));
});

function itemFeed(titulo: string, url: string, resumo = "[exemplo] resumo ficticio") {
  return {
    title: `${titulo} - Jornal Exemplo`,
    link: url,
    pubDate: "Mon, 24 Aug 2026 10:00:00 GMT",
    contentSnippet: resumo,
  };
}

describe("rodarColetaNoticias (RSS mockado, banco real)", () => {
  it("busca por termo, normaliza e grava noticias novas", async () => {
    parseURL.mockResolvedValue({
      items: [
        itemFeed("[exemplo] noticia um", "https://exemplo.invalid/noticia-1"),
        itemFeed("[exemplo] noticia dois", "https://exemplo.invalid/noticia-2"),
      ],
    });

    const resumo = await rodarColetaNoticias(undefined, SEM_REDE);
    expect(resumo.noticiasProcessadas).toBe(2);

    const linhas = await db().select().from(noticias).where(eq(noticias.nichoId, nichoId));
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => l.titulo)).toContain("[exemplo] noticia um");
  });

  it("rodar duas vezes para a mesma url atualiza em vez de duplicar (idempotencia por url)", async () => {
    parseURL.mockResolvedValue({
      items: [itemFeed("[exemplo] titulo antigo", "https://exemplo.invalid/repetida")],
    });
    await rodarColetaNoticias(undefined, SEM_REDE);

    parseURL.mockResolvedValue({
      items: [itemFeed("[exemplo] titulo atualizado", "https://exemplo.invalid/repetida")],
    });
    await rodarColetaNoticias(undefined, SEM_REDE);

    const linhas = await db().select().from(noticias).where(eq(noticias.url, "https://exemplo.invalid/repetida"));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].titulo).toBe("[exemplo] titulo atualizado");
  });

  it("um termo com erro de rede nao impede os outros termos de gravar", async () => {
    const [outroNicho] = await db()
      .insert(nichos)
      .values({
        slug: "coleta-noticias-teste-2",
        nome: "Coleta noticias teste 2",
        termos: ["termo bom", "termo com erro"],
      })
      .returning();

    parseURL.mockImplementation(async (url: string) => {
      if (decodeURIComponent(url).includes("termo com erro")) throw new Error("timeout de rede simulado");
      return { items: [itemFeed("[exemplo] noticia do termo bom", "https://exemplo.invalid/termo-bom")] };
    });

    const resumo = await rodarColetaNoticias(undefined, SEM_REDE);
    expect(resumo.noticiasProcessadas).toBeGreaterThanOrEqual(1);
    expect((resumo.erros as string[] | undefined)?.length).toBe(1);

    await db().delete(noticias).where(eq(noticias.nichoId, outroNicho.id));
    await db().delete(nichos).where(eq(nichos.id, outroNicho.id));
  });

  it("a rodada de todos os setores lê cada feed dos portais curados uma vez, pelo `baixar` injetado, e um feed fora do ar não derruba a coleta (E53, foto do setor)", async () => {
    parseURL.mockResolvedValue({ items: [itemFeed("[exemplo] noticia que espera foto", "https://exemplo.invalid/espera-foto")] });

    const resumo = await rodarColetaNoticias(undefined, SEM_REDE);

    expect(resumo.noticiasProcessadas).toBe(1);
    // Sem assunto ativo, a coleta dos assuntos sai antes de baixar; quem baixa é a foto do setor, e só ela: cada um dos feeds, uma vez.
    const feeds = FONTES_DE_NOTICIAS.flatMap((fonte) => fonte.feeds.map((feed) => feed.url));
    expect([...baixados].sort()).toEqual([...feeds].sort());
    expect(paginasLidas).toEqual([]);
    // Os feeds que não responderam só viram falha no resumo das fotos; a coleta seguiu e gravou.
    const fotos = resumo.fotos as { feedsLidos: number; fotosDoFeed: number; falhas?: string[] };
    expect(fotos).toMatchObject({ feedsLidos: 0, fotosDoFeed: 0 });
    expect(fotos.falhas).toHaveLength(feeds.length);
    expect(resumo.erros).toBeUndefined();
  });

  it("com nichoId, roda so para aquele nicho (etapa 24, parte 1: coletar agora)", async () => {
    const [outroNicho] = await db()
      .insert(nichos)
      .values({ slug: "coleta-noticias-outro", nome: "Coleta noticias outro nicho", termos: ["esteticista"] })
      .returning();

    try {
      parseURL.mockResolvedValue({
        items: [itemFeed("[exemplo] noticia escopada", "https://exemplo.invalid/escopada")],
      });

      const resumo = await rodarColetaNoticias(nichoId, SEM_REDE);
      // A coleta de um ramo só (o "coletar agora" do admin) não lê feed de portal nenhum: nem a dos assuntos nem a das fotos.
      expect(baixados).toEqual([]);
      expect(paginasLidas).toEqual([]);
      expect(resumo.nichos).toBe(1);
      expect(parseURL).toHaveBeenCalledTimes(1);
      expect(decodeURIComponent(String(parseURL.mock.calls[0][0]))).toContain("dentista");
    } finally {
      await db().delete(noticias).where(eq(noticias.nichoId, outroNicho.id));
      await db().delete(nichos).where(eq(nichos.id, outroNicho.id));
    }
  });
});
