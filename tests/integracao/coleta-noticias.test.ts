/**
 * Ciclo completo da coleta de noticias contra o Postgres real, com o RSS
 * mockado (etapa 6, criterio de aceite): busca por termo, normaliza, grava,
 * e idempotencia por `noticias.url` (rodar duas vezes atualiza em vez de
 * duplicar).
 */
import { eq } from "drizzle-orm";
import Parser from "rss-parser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { nichos, noticias } from "@/db/schema";
import { rodarColetaNoticias } from "@/jobs/coleta-noticias";

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

    const resumo = await rodarColetaNoticias();
    expect(resumo.noticiasProcessadas).toBe(2);

    const linhas = await db().select().from(noticias).where(eq(noticias.nichoId, nichoId));
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => l.titulo)).toContain("[exemplo] noticia um");
  });

  it("rodar duas vezes para a mesma url atualiza em vez de duplicar (idempotencia por url)", async () => {
    parseURL.mockResolvedValue({
      items: [itemFeed("[exemplo] titulo antigo", "https://exemplo.invalid/repetida")],
    });
    await rodarColetaNoticias();

    parseURL.mockResolvedValue({
      items: [itemFeed("[exemplo] titulo atualizado", "https://exemplo.invalid/repetida")],
    });
    await rodarColetaNoticias();

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

    const resumo = await rodarColetaNoticias();
    expect(resumo.noticiasProcessadas).toBeGreaterThanOrEqual(1);
    expect((resumo.erros as string[] | undefined)?.length).toBe(1);

    await db().delete(noticias).where(eq(noticias.nichoId, outroNicho.id));
    await db().delete(nichos).where(eq(nichos.id, outroNicho.id));
  });
});
