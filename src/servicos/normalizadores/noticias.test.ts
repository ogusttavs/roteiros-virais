import { readFileSync } from "node:fs";
import path from "node:path";

import Parser from "rss-parser";
import { describe, expect, it } from "vitest";

import { normalizarNoticiaRss } from "./noticias";

async function carregarFeedFixture() {
  const caminho = path.resolve(process.cwd(), "tests/fixtures/coleta/google-news.xml");
  const xml = readFileSync(caminho, "utf8");
  return new Parser().parseString(xml);
}

describe("normalizarNoticiaRss", () => {
  it("separa titulo e fonte quando o titulo do Google News vem como 'Manchete - Fonte'", async () => {
    const feed = await carregarFeedFixture();
    const resultado = normalizarNoticiaRss(feed.items[0]);

    expect(resultado.titulo).toBe("[exemplo] Procura por clareamento dental cresce no verao");
    expect(resultado.fonte).toBe("Jornal Exemplo");
    expect(resultado.url).toBe("https://news.google.com/rss/articles/exemplo-1");
    expect(resultado.publicadoEm).toEqual(new Date("Mon, 24 Aug 2026 10:00:00 GMT"));
    expect(resultado.resumo).toContain("resumo ficticio da noticia");
  });

  it("sem ' - Fonte' no titulo, a fonte fica nula e o titulo inteiro e mantido", async () => {
    const feed = await carregarFeedFixture();
    const resultado = normalizarNoticiaRss(feed.items[1]);

    expect(resultado.titulo).toBe("[exemplo] O que muda no atendimento odontologico este ano");
    expect(resultado.fonte).toBeNull();
  });

  it("sem link, a url fica vazia (quem chama descarta o item)", () => {
    const resultado = normalizarNoticiaRss({ title: "sem link" });
    expect(resultado.url).toBe("");
  });

  it("sem titulo, o titulo fica vazio (quem chama descarta o item)", () => {
    const resultado = normalizarNoticiaRss({ link: "https://exemplo.invalid/sem-titulo" });
    expect(resultado.titulo).toBe("");
  });
});
