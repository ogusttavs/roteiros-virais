/**
 * A foto das notícias do setor (E53, item seguinte), contra o Postgres real e com RSS de exemplo escrito aqui (nenhuma chamada de rede): a notícia do setor que o Google News trouxe (sem foto)
 * ganha a foto do feed do portal quando o título bate, com o crédito do veículo; o endereço de veículo curado pode ganhar o `og:image` da página, com teto por setor; feed fora do ar só tira o
 * veículo da rodada; o que já tem foto não é tocado; e a capa leva a foto (revalidada) do setor.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FONTES_DE_NOTICIAS, LIMITE_FOTOS_DE_PAGINA_POR_ASSUNTO_POR_DIA } from "@/config/fontes-noticias";
import { db, getPool } from "@/db";
import { clientes, nichos, noticias } from "@/db/schema";
import { juntarFotosDasNoticiasDoSetor } from "@/jobs/foto-das-noticias-do-setor";
import { capaDoDia } from "@/servicos/noticias-do-dia";

import { resetarSchema } from "../../scripts/resetar-schema";

const AGORA = new Date("2026-10-06T15:00:00Z");
const HORA = 60 * 60 * 1000;
const URL_DO_G1 = FONTES_DE_NOTICIAS[0].feeds[0].url;
const URL_DA_FOLHA = FONTES_DE_NOTICIAS[1].feeds[0].url;

let nichoId: number;
let marcaId: number;

function rss(itens: { titulo: string; link: string; imagem?: string }[]): string {
  const corpo = itens
    .map((i) => `<item><title>${i.titulo}</title><link>${i.link}</link>${i.imagem ? `<media:content url="${i.imagem}" medium="image"/>` : ""}<pubDate>Tue, 06 Oct 2026 14:00:00 -0000</pubDate></item>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:media="http://search.yahoo.com/mrss/" version="2.0"><channel><title>feed</title>${corpo}</channel></rss>`;
}

/** Só o G1 e a Folha (capa) respondem; o resto responde 503, como um portal fora do ar. */
const FEEDS: Record<string, string> = {
  [URL_DO_G1]: rss([{ titulo: "Preço da limpeza profissional sobe em outubro", link: "https://g1.globo.com/economia/limpeza.ghtml", imagem: "https://s2-g1.glbimg.com/limpeza.jpg" }]),
  [URL_DA_FOLHA]: rss([{ titulo: "Clínicas de estética crescem no interior", link: "https://www1.folha.uol.com.br/mercado/estetica.shtml", imagem: "https://f.i.uol.com.br/estetica.jpg" }]),
};
async function baixar(url: string): Promise<string> {
  const xml = FEEDS[url];
  if (!xml) throw new Error("o feed respondeu 503");
  return xml;
}

const paginasBuscadas: string[] = [];
let fotosDePagina: Record<string, string | null> = {};
async function buscarPagina(url: string): Promise<string | null> {
  paginasBuscadas.push(url);
  return fotosDePagina[url] ?? null;
}

async function inserir(titulo: string, url: string, extra: Partial<typeof noticias.$inferInsert> = {}): Promise<number> {
  const [linha] = await db()
    .insert(noticias)
    .values({ nichoId, titulo, url, fonte: "G1", publicadoEm: new Date(AGORA.getTime() - 2 * HORA), relevante: true, coletadoEm: new Date(AGORA.getTime() - HORA), ...extra })
    .returning({ id: noticias.id });
  return linha.id;
}

async function foto(id: number) {
  const [linha] = await db().select({ imagemUrl: noticias.imagemUrl, imagemCredito: noticias.imagemCredito }).from(noticias).where(eq(noticias.id, id));
  return linha;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "fotos-do-setor", nome: "Produtos de limpeza", termos: [] }).returning();
  nichoId = nicho.id;
  const [marca] = await db().insert(clientes).values({ nome: "marca", nichoId }).returning({ id: clientes.id });
  marcaId = marca.id;
}, 60_000);

beforeEach(async () => {
  await db().delete(noticias);
  paginasBuscadas.length = 0;
  fotosDePagina = {};
});

afterAll(async () => {
  await getPool().end();
});

describe("juntarFotosDasNoticiasDoSetor", () => {
  it("a notícia do Google News com o mesmo título de um item do feed ganha a foto e o crédito do veículo", async () => {
    const id = await inserir("Preço da limpeza profissional sobe em outubro", "https://news.google.com/rss/articles/abc");
    const semMatch = await inserir("Uma manchete que só o Google News tem", "https://news.google.com/rss/articles/def");

    const resumo = await juntarFotosDasNoticiasDoSetor({ agora: AGORA, baixar, buscarPagina });

    expect(await foto(id)).toEqual({ imagemUrl: "https://s2-g1.glbimg.com/limpeza.jpg", imagemCredito: "Foto: G1" });
    expect(await foto(semMatch)).toEqual({ imagemUrl: null, imagemCredito: null });
    expect(resumo).toMatchObject({ fotosDoFeed: 1, fotosDePagina: 0, semFoto: 1 });
    // O redirecionador do Google nunca é buscado como página.
    expect(paginasBuscadas).toEqual([]);
    // Os portais fora do ar só aparecem nas falhas, e o resto da rodada seguiu.
    expect(resumo.feedsLidos).toBe(2);
    expect(resumo.falhas?.length).toBeGreaterThan(0);
  });

  it("a notícia de OUTRO veículo com o mesmo título não ganha a foto do G1 (o cartão ficaria dizendo Valor com foto do G1)", async () => {
    const doValor = await inserir("Preço da limpeza profissional sobe em outubro", "https://news.google.com/rss/articles/valor", { fonte: "Valor Econômico" });
    const doG1 = await inserir("Preço da limpeza profissional sobe em outubro", "https://news.google.com/rss/articles/g1", { fonte: "g1" });

    await juntarFotosDasNoticiasDoSetor({ agora: AGORA, baixar, buscarPagina });

    expect(await foto(doValor)).toEqual({ imagemUrl: null, imagemCredito: null });
    expect(await foto(doG1)).toEqual({ imagemUrl: "https://s2-g1.glbimg.com/limpeza.jpg", imagemCredito: "Foto: G1" });
  });

  it("a notícia que já tem foto não é tocada, e a que é antiga demais não disputa foto", async () => {
    const jaTem = await inserir("Preço da limpeza profissional sobe em outubro", "https://news.google.com/rss/articles/ja", { imagemUrl: "https://exemplo.com/minha.jpg", imagemCredito: "Foto: Outro" });
    const antiga = await inserir("Preço da limpeza profissional sobe em outubro", "https://news.google.com/rss/articles/velha", { coletadoEm: new Date(AGORA.getTime() - 10 * 24 * HORA) });

    await juntarFotosDasNoticiasDoSetor({ agora: AGORA, baixar, buscarPagina });

    expect(await foto(jaTem)).toEqual({ imagemUrl: "https://exemplo.com/minha.jpg", imagemCredito: "Foto: Outro" });
    expect(await foto(antiga)).toEqual({ imagemUrl: null, imagemCredito: null });
  });

  it("o endereço de veículo curado ganha o og:image da página, com teto por setor por dia; o resto fica sem foto", async () => {
    const ids: number[] = [];
    for (let i = 0; i < LIMITE_FOTOS_DE_PAGINA_POR_ASSUNTO_POR_DIA + 2; i += 1) {
      const url = `https://g1.globo.com/saude/noticia-${i}.ghtml`;
      fotosDePagina[url] = `https://s2-g1.glbimg.com/pagina-${i}.jpg`;
      ids.push(await inserir(`Manchete do veículo número ${i}`, url));
    }

    const resumo = await juntarFotosDasNoticiasDoSetor({ agora: AGORA, baixar, buscarPagina });

    expect(paginasBuscadas.length).toBe(LIMITE_FOTOS_DE_PAGINA_POR_ASSUNTO_POR_DIA);
    expect(resumo.fotosDePagina).toBe(LIMITE_FOTOS_DE_PAGINA_POR_ASSUNTO_POR_DIA);
    expect(resumo.semFoto).toBe(2);
    // O crédito é o veículo que a notícia já diz ser.
    const comFoto = (await Promise.all(ids.map(foto))).filter((f) => f.imagemUrl);
    expect(comFoto.length).toBe(LIMITE_FOTOS_DE_PAGINA_POR_ASSUNTO_POR_DIA);
    expect(comFoto.every((f) => f.imagemCredito === "Foto: G1")).toBe(true);
  });

  it("uma página que não tem og:image, ou cuja foto não é https, deixa a notícia sem foto", async () => {
    const url = "https://g1.globo.com/saude/sem-foto.ghtml";
    const semOg = await inserir("Manchete sem foto na página", url);
    const urlRuim = "https://g1.globo.com/saude/foto-ruim.ghtml";
    fotosDePagina[urlRuim] = "http://inseguro.exemplo/foto.jpg";
    const ruim = await inserir("Manchete com foto insegura", urlRuim);

    const resumo = await juntarFotosDasNoticiasDoSetor({ agora: AGORA, baixar, buscarPagina });

    expect(await foto(semOg)).toEqual({ imagemUrl: null, imagemCredito: null });
    expect(await foto(ruim)).toEqual({ imagemUrl: null, imagemCredito: null });
    expect(resumo.fotosDePagina).toBe(0);
  });

  it("sem notícia recente do setor sem foto, não baixa feed nenhum", async () => {
    let baixados = 0;
    const resumo = await juntarFotosDasNoticiasDoSetor({
      agora: AGORA,
      baixar: async (url) => {
        baixados += 1;
        return baixar(url);
      },
      buscarPagina,
    });
    expect(baixados).toBe(0);
    expect(resumo).toEqual({ feedsLidos: 0, fotosDoFeed: 0, fotosDePagina: 0, semFoto: 0 });
  });
});

describe("a capa leva a foto do setor", () => {
  it("a notícia do setor com foto sai com a imagem e o crédito; foto que não é https vira bloco de tipografia", async () => {
    await inserir("Setor com foto", "https://g1.globo.com/a", { imagemUrl: "https://s2-g1.glbimg.com/a.jpg", imagemCredito: "Foto: G1" });
    await inserir("Setor com foto ruim", "https://g1.globo.com/b", { imagemUrl: "http://inseguro.exemplo/b.jpg", imagemCredito: "Foto: G1" });
    await inserir("Setor sem foto", "https://g1.globo.com/c");

    const capa = await capaDoDia({ id: marcaId, nichoId }, AGORA);
    const porTitulo = new Map([...capa.deHoje, ...capa.deOntem].map((n) => [n.titulo, n]));

    expect(porTitulo.get("Setor com foto")).toMatchObject({ imagemUrl: "https://s2-g1.glbimg.com/a.jpg", imagemCredito: "Foto: G1" });
    expect(porTitulo.get("Setor com foto ruim")).toMatchObject({ imagemUrl: null, imagemCredito: null });
    expect(porTitulo.get("Setor sem foto")).toMatchObject({ imagemUrl: null, imagemCredito: null });
  });
});
