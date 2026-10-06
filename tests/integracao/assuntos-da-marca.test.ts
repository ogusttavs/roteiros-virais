/**
 * A E53, o motor, contra o Postgres real e com RSS de exemplo GRAVADO (nenhuma chamada de rede): os assuntos da marca (até cinco, sem repetir, só da própria marca), a coleta por
 * assunto (os feeds dos portais e o Google News, a junção de duplicatas, a foto do veículo com o crédito, o resumo nosso e nunca o texto da matéria, o teto, a idempotência), o assunto
 * que sai sozinho depois de 30 dias sem abrir notícia (menos o fixado), e as notícias do dia do assunto como fonte do roteiro: o roteiro de tema livre cita o veículo e o dia, e a marca
 * sem o assunto não recebe nada.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LIMITE_NOVAS_POR_ASSUNTO_POR_DIA } from "@/config/fontes-noticias";
import { db, getPool } from "@/db";
import { assuntosDaMarca, briefings, clientes, geracoesIA, nichos, noticiasDoAssunto, roteiros, user } from "@/db/schema";
import { coletarNoticiasDosAssuntos, decodificarFeed, urlDoGoogleNews } from "@/jobs/coleta-assuntos";
import {
  adicionarAssunto,
  assuntosAtivosDaMarca,
  ErroAssunto,
  expirarAssuntosSemUso,
  fixarAssunto,
  noticiasDeHojeDosAssuntos,
  registrarAberturaDeNoticia,
  removerAssunto,
} from "@/servicos/assuntos";
import { gerarRoteiro } from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

const AGORA = new Date("2026-10-06T18:00:00Z");
const DIA_MS = 24 * 60 * 60 * 1000;
const PASTA = path.join(process.cwd(), "tests", "fixtures", "rss-assuntos");
const ler = (nome: string) => new Uint8Array(readFileSync(path.join(PASTA, nome)));

const FEEDS: Record<string, Uint8Array> = {
  "https://g1.globo.com/rss/g1/politica/": ler("g1-politica.xml"),
  "https://feeds.folha.uol.com.br/poder/rss091.xml": ler("folha-poder.xml"),
  "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/politica/": ler("estadao-politica.xml"),
  [urlDoGoogleNews("eleição")]: ler("google-eleicao.xml"),
  [urlDoGoogleNews("Flávio")]: ler("google-eleicao.xml"),
};

/** Sem rede: devolve o feed gravado (decodificado como o de verdade, pela codificação que ele declara); o que não está gravado falha, como um portal fora do ar. */
async function baixar(url: string): Promise<string> {
  const bytes = FEEDS[url];
  if (!bytes) throw new Error("o feed respondeu 503");
  return decodificarFeed(bytes);
}

const PAGINAS: Record<string, string | null> = {
  "https://www1.folha.uol.com.br/poder/2026/10/estrategistas-comemoram.shtml": "https://f.i.uol.com.br/fotografia/2026/10/06/estrategistas.jpg",
};
const paginasBuscadas: string[] = [];
async function buscarPagina(url: string): Promise<string | null> {
  paginasBuscadas.push(url);
  return PAGINAS[url] ?? null;
}

let nichoId: number;
let marcaA: number;
let marcaB: number;
let assuntoId: number;

async function novaMarca(nome: string): Promise<number> {
  const usuarioId = `assuntos-${nome}`;
  await db().insert(user).values({ id: usuarioId, name: nome, email: `${usuarioId}@assuntos.teste` });
  const [cliente] = await db().insert(clientes).values({ usuarioId, nome, nichoId }).returning();
  await db()
    .insert(briefings)
    .values({
      clienteId: cliente.id,
      completo: true,
      perfil: {
        fatos: { oQueVende: "consultoria", preco: "R$ 400", clienteIdeal: "autonomo", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: ["a mesa de trabalho"], concorrentes: [], perfisAdmirados: [] },
        resumo: "consultoria para autônomos",
        referencias: [],
      },
    });
  return cliente.id;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "assuntos-teste", nome: "Assuntos teste", termos: [] }).returning();
  nichoId = nicho.id;
  marcaA = await novaMarca("marca-com-assunto");
  marcaB = await novaMarca("marca-sem-assunto");
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

describe("os assuntos da marca", () => {
  it("adiciona com os termos, aparado; recusa vazio, repetido (sem acento nem maiúscula) e o sexto", async () => {
    const primeiro = await adicionarAssunto(marcaA, "  eleição  ", "Flávio, candidato");
    assuntoId = primeiro.id;
    expect(primeiro).toMatchObject({ texto: "eleição", termos: ["Flávio", "candidato"], fixado: false, ativo: true });

    await expect(adicionarAssunto(marcaA, "a")).rejects.toBeInstanceOf(ErroAssunto);
    await expect(adicionarAssunto(marcaA, "ELEICAO")).rejects.toThrow("já está sendo acompanhado");
    await expect(adicionarAssunto(marcaA, "x".repeat(61))).rejects.toBeInstanceOf(ErroAssunto);
    for (const t of ["economia", "esporte", "tecnologia", "saúde"]) await adicionarAssunto(marcaA, t);
    await expect(adicionarAssunto(marcaA, "cultura")).rejects.toThrow("até 5 assuntos");
    expect(await assuntosAtivosDaMarca(marcaA)).toHaveLength(5);
  });

  it("tirar não apaga, libera a vaga e só vale para a própria marca; fixar também", async () => {
    const [esporte] = (await assuntosAtivosDaMarca(marcaA)).filter((a) => a.texto === "esporte");
    await expect(removerAssunto(marcaB, esporte.id)).rejects.toBeInstanceOf(ErroAssunto);
    await expect(fixarAssunto(marcaB, esporte.id, true)).rejects.toBeInstanceOf(ErroAssunto);
    await removerAssunto(marcaA, esporte.id);
    expect(await assuntosAtivosDaMarca(marcaA)).toHaveLength(4);
    const [linha] = await db().select().from(assuntosDaMarca).where(eq(assuntosDaMarca.id, esporte.id));
    expect(linha.ativo).toBe(false);
    for (const a of await assuntosAtivosDaMarca(marcaA)) if (a.id !== assuntoId) await removerAssunto(marcaA, a.id);
    expect(await assuntosAtivosDaMarca(marcaA)).toHaveLength(1);
  });
});

describe("a coleta por assunto (RSS gravado, sem rede)", () => {
  it("lê os feeds dos portais e o Google News, junta duplicatas, põe foto com crédito e resumo nosso, e guarda só título, veículo, hora, link, foto e resumo", async () => {
    const resumo = await coletarNoticiasDosAssuntos({ agora: AGORA, baixar, buscarPagina });
    // G1, Folha e Estadão responderam; os outros portais "estão fora do ar" e só somem desta coleta.
    expect(resumo.feedsLidos).toBe(3);
    expect(resumo.falhas?.some((f) => f.includes("CNN Brasil"))).toBe(true);
    expect(resumo.assuntos).toBe(1);
    // A do G1 (a mesma do Google News, junta), a da Folha, a do Estadão e a do Poder360 pelo Google. A de 2022 e as que não tocam o assunto ficam de fora.
    expect(resumo.noticiasNovas).toBe(4);
    expect(resumo.resumos).toBe(4);

    const guardadas = await db().select().from(noticiasDoAssunto).where(eq(noticiasDoAssunto.assuntoId, assuntoId));
    const porTitulo = (parte: string) => guardadas.find((n) => n.titulo.includes(parte))!;

    const g1 = porTitulo("Debate esquenta");
    expect(g1).toMatchObject({ veiculo: "G1", origem: "rss", imagemUrl: "https://s2-g1.glbimg.com/exemplo/debate.jpg", imagemCredito: "Foto: G1" });
    expect(g1.publicadoEm?.toISOString()).toBe("2026-10-06T14:30:00.000Z");

    // A Folha: acento certo (ISO-8859-1 declarado), link verdadeiro (sem o redirecionador) e a foto veio da página (og:image), com o crédito do veículo.
    const folha = porTitulo("Flávio Bolsonaro e a eleição");
    expect(folha).toMatchObject({ veiculo: "Folha de S.Paulo", url: "https://www1.folha.uol.com.br/poder/2026/10/estrategistas-comemoram.shtml", imagemUrl: "https://f.i.uol.com.br/fotografia/2026/10/06/estrategistas.jpg", imagemCredito: "Foto: Folha de S.Paulo" });

    // O Estadão: sem foto no feed e sem foto na página: sem foto e sem crédito, nunca uma foto nossa.
    const estadao = porTitulo("Marinho promete");
    expect(estadao).toMatchObject({ veiculo: "Estadão", imagemUrl: null, imagemCredito: null });

    // Do Google News: o veículo vem do fim do título e não se busca foto de página (o link é do Google).
    const poder = porTitulo("Candidato promete");
    expect(poder).toMatchObject({ veiculo: "Poder360", origem: "google", imagemUrl: null });
    expect(paginasBuscadas.some((u) => u.includes("news.google.com"))).toBe(false);

    // O resumo é nosso (o mock devolve "Resumo: <título>."), e o texto inteiro da matéria não está em lugar nenhum do que se guardou.
    for (const n of guardadas) {
      expect(n.resumoNosso).toMatch(/^Resumo: /);
      expect(JSON.stringify(n)).not.toContain("Texto inteiro da matéria");
    }
    // O custo do resumo fica registrado como os outros, na marca do assunto.
    const geracoes = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "resumirNoticia"));
    expect(geracoes).toHaveLength(4);
    expect(geracoes.every((g) => g.clienteId === marcaA)).toBe(true);
  });

  it("rodar de novo no mesmo dia não duplica nada nem gasta outro resumo", async () => {
    const antes = (await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "resumirNoticia"))).length;
    const resumo = await coletarNoticiasDosAssuntos({ agora: AGORA, baixar, buscarPagina });
    expect(resumo.noticiasNovas).toBe(0);
    expect(resumo.resumos).toBe(0);
    expect((await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "resumirNoticia"))).length).toBe(antes);
    expect(await db().select().from(noticiasDoAssunto).where(eq(noticiasDoAssunto.assuntoId, assuntoId))).toHaveLength(4);
  });

  it(`o teto por assunto por dia (${LIMITE_NOVAS_POR_ASSUNTO_POR_DIA}) vale mesmo com mais notícias: as mais recentes primeiro`, async () => {
    const outro = await adicionarAssunto(marcaB, "muitas");
    const itens = Array.from({ length: 20 }, (_, i) => `<item><title>Notícia ${i} sobre muitas coisas - Veículo ${i}</title><link>https://news.google.com/rss/articles/m${i}</link><pubDate>Tue, 06 Oct 2026 ${String(10 + (i % 8)).padStart(2, "0")}:${String(i).padStart(2, "0")}:00 GMT</pubDate></item>`).join("");
    const feedGrande = new TextEncoder().encode(`<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${itens}</channel></rss>`);
    const baixarGrande = async (url: string) => (url === urlDoGoogleNews("muitas") ? decodificarFeed(feedGrande) : baixar(url));
    const resumo = await coletarNoticiasDosAssuntos({ agora: AGORA, baixar: baixarGrande, buscarPagina });
    expect(resumo.noticiasNovas).toBe(LIMITE_NOVAS_POR_ASSUNTO_POR_DIA);
    expect(await db().select().from(noticiasDoAssunto).where(eq(noticiasDoAssunto.assuntoId, outro.id))).toHaveLength(LIMITE_NOVAS_POR_ASSUNTO_POR_DIA);
    await removerAssunto(marcaB, outro.id);
  });
});

describe("o assunto que sai sozinho", () => {
  it("30 dias sem abrir notícia (ou sem nunca abrir, desde que nasceu) tira o assunto, menos o fixado; abrir uma notícia mantém", async () => {
    const velho = await adicionarAssunto(marcaB, "velho sem uso");
    const fixado = await adicionarAssunto(marcaB, "velho mas fixado");
    const aberto = await adicionarAssunto(marcaB, "velho mas aberto");
    const trintaEUm = new Date(AGORA.getTime() - 31 * DIA_MS);
    for (const a of [velho, fixado, aberto]) await db().update(assuntosDaMarca).set({ criadoEm: trintaEUm }).where(eq(assuntosDaMarca.id, a.id));
    await fixarAssunto(marcaB, fixado.id, true);
    // Uma notícia do assunto "aberto", aberta há 5 dias: ele continua vivo.
    const [noticia] = await db()
      .insert(noticiasDoAssunto)
      .values({ assuntoId: aberto.id, titulo: "x", veiculo: "G1", url: "https://g1.globo.com/x", publicadoEm: AGORA, origem: "rss" })
      .returning();
    await registrarAberturaDeNoticia(marcaB, noticia.id, new Date(AGORA.getTime() - 5 * DIA_MS));
    await expect(registrarAberturaDeNoticia(marcaA, noticia.id)).rejects.toBeInstanceOf(ErroAssunto);

    expect(await expirarAssuntosSemUso(AGORA)).toBe(1);
    const ativos = (await assuntosAtivosDaMarca(marcaB)).map((a) => a.texto);
    expect(ativos).toContain("velho mas fixado");
    expect(ativos).toContain("velho mas aberto");
    expect(ativos).not.toContain("velho sem uso");
    const [saido] = await db().select().from(assuntosDaMarca).where(eq(assuntosDaMarca.id, velho.id));
    expect(saido.expiradoEm).not.toBeNull();

    // Abrir deixa de contar depois de 31 dias: o "aberto" também sai.
    await db().update(assuntosDaMarca).set({ ultimoAbertoEm: trintaEUm }).where(eq(assuntosDaMarca.id, aberto.id));
    expect(await expirarAssuntosSemUso(AGORA)).toBe(1);
    for (const a of await assuntosAtivosDaMarca(marcaB)) await removerAssunto(marcaB, a.id);
  });
});

describe("as notícias do assunto como fonte do roteiro", () => {
  it("só quando o texto toca o assunto, só da marca dele, e só as de hoje", async () => {
    const tocando = await noticiasDeHojeDosAssuntos(marcaA, "o que a eleição muda para mim", AGORA);
    expect(tocando.length).toBe(4);
    expect(tocando[0]).toMatchObject({ assunto: "eleição" });
    expect(tocando.some((n) => n.veiculo === "G1" && n.dia === "6 de outubro")).toBe(true);
    expect(await noticiasDeHojeDosAssuntos(marcaA, "como organizar o caixa da semana", AGORA)).toEqual([]);
    // A marca sem o assunto não vê nem recebe nada.
    expect(await noticiasDeHojeDosAssuntos(marcaB, "o que a eleição muda para mim", AGORA)).toEqual([]);
    // Daqui a 3 dias já não são "de hoje".
    expect(await noticiasDeHojeDosAssuntos(marcaA, "a eleição", new Date(AGORA.getTime() + 3 * DIA_MS))).toEqual([]);
  });

  it("o roteiro de tema livre 'eleição' cita o veículo e o dia vindos dessas notícias; o da marca sem o assunto não cita nada delas", async () => {
    // As notícias de "hoje" para o relógio de verdade: a coleta de cima usou o relógio injetado, aqui a data delas passa a ser a de agora.
    await db().update(noticiasDoAssunto).set({ publicadoEm: new Date() }).where(eq(noticiasDoAssunto.assuntoId, assuntoId));

    const com = await gerarRoteiro(marcaA, { origem: "livre", textoTema: "o que a eleição muda para o meu negócio", objetivo: "conversao" });
    expect(com.conteudo.corpo).toMatch(/Segundo o .+, em \d+ de \w+,/);
    const sem = await gerarRoteiro(marcaB, { origem: "livre", textoTema: "o que a eleição muda para o meu negócio", objetivo: "conversao" });
    expect(sem.conteudo.corpo).not.toContain("Segundo o");
    expect(await db().select({ id: roteiros.id }).from(roteiros)).toHaveLength(2);
  });
});

function feedGoogle(termo: string, quantos: number, prefixo = ""): Uint8Array {
  const itens = Array.from({ length: quantos }, (_, i) => `<item><title>${prefixo}Manchete ${i} de ${termo} - Veículo ${i}</title><link>https://news.google.com/rss/articles/${termo}-${prefixo}${i}</link><pubDate>Tue, 06 Oct 2026 12:${String(i).padStart(2, "0")}:00 GMT</pubDate></item>`).join("");
  return new TextEncoder().encode(`<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${itens}</channel></rss>`);
}

function baixarSo(feeds: Record<string, Uint8Array>) {
  return async (url: string) => {
    const bytes = feeds[url];
    if (!bytes) throw new Error("o feed respondeu 503");
    return decodificarFeed(bytes);
  };
}

describe("os tetos e as defesas da revisão do PR 140", () => {
  it("o teto de resumos por marca no dia (30) vale somando os assuntos, e tirar e pôr o mesmo assunto não zera o teto", async () => {
    const marcaC = await novaMarca("marca-teto");
    for (const t of ["alfa", "beta", "gama"]) await adicionarAssunto(marcaC, t);
    const feeds = Object.fromEntries(["alfa", "beta", "gama"].map((t) => [urlDoGoogleNews(t), feedGoogle(t, 15)]));
    const resumo = await coletarNoticiasDosAssuntos({ agora: AGORA, baixar: baixarSo(feeds), buscarPagina, gastoDoDiaBrl: async () => 0, tetoDiarioBrl: async () => 20 });
    expect(resumo.noticiasNovas).toBe(30);
    expect(resumo.semResumoPeloTeto).toBe(6);

    // Tirar "alfa" e pôr de novo (outro id) com notícias novas: o teto de hoje, por marca e texto, continua cheio.
    const [alfa] = (await assuntosAtivosDaMarca(marcaC)).filter((a) => a.texto === "alfa");
    await removerAssunto(marcaC, alfa.id);
    await adicionarAssunto(marcaC, "alfa");
    const feeds2 = { ...feeds, [urlDoGoogleNews("alfa")]: feedGoogle("alfa", 15, "Outra ") };
    const de_novo = await coletarNoticiasDosAssuntos({ agora: AGORA, baixar: baixarSo(feeds2), buscarPagina, gastoDoDiaBrl: async () => 0, tetoDiarioBrl: async () => 20 });
    expect(de_novo.noticiasNovas).toBe(0);
    for (const a of await assuntosAtivosDaMarca(marcaC)) await removerAssunto(marcaC, a.id);
  });

  it("o job para quando o gasto de IA do dia passa do teto diário, e diz o motivo no resumo", async () => {
    const marcaD = await novaMarca("marca-gasto");
    await adicionarAssunto(marcaD, "delta");
    const feeds = { [urlDoGoogleNews("delta")]: feedGoogle("delta", 3) };
    const resumo = await coletarNoticiasDosAssuntos({ agora: AGORA, baixar: baixarSo(feeds), buscarPagina, gastoDoDiaBrl: async () => 25, tetoDiarioBrl: async () => 20 });
    expect(resumo.noticiasNovas).toBe(0);
    expect(resumo.paradoPor).toContain("passou do teto diário");
    // Com folga no teto, a mesma coleta segue.
    const seguiu = await coletarNoticiasDosAssuntos({ agora: AGORA, baixar: baixarSo(feeds), buscarPagina, gastoDoDiaBrl: async () => 5, tetoDiarioBrl: async () => 20 });
    expect(seguiu.noticiasNovas).toBe(3);
    expect(seguiu.paradoPor).toBeUndefined();
  });

  it("a mesma manchete com outro endereço, em outra rodada do mesmo dia, não entra de novo; e a do fonte aparece uma vez só", async () => {
    const marcaE = await novaMarca("marca-manchete");
    await adicionarAssunto(marcaE, "epsilon");
    await adicionarAssunto(marcaE, "zeta", "epsilon");
    const um = new TextEncoder().encode(`<?xml version="1.0"?><rss version="2.0"><channel><title>x</title><item><title>Epsilon sobe forte - Veículo A</title><link>https://news.google.com/rss/articles/a1</link><pubDate>Tue, 06 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`);
    const outroEndereco = new TextEncoder().encode(`<?xml version="1.0"?><rss version="2.0"><channel><title>x</title><item><title>Epsilon sobe forte! - Veículo A</title><link>https://news.google.com/rss/articles/a2</link><pubDate>Tue, 06 Oct 2026 12:30:00 GMT</pubDate></item></channel></rss>`);
    const primeira = await coletarNoticiasDosAssuntos({ agora: AGORA, baixar: baixarSo({ [urlDoGoogleNews("epsilon")]: um, [urlDoGoogleNews("zeta")]: um }), buscarPagina, gastoDoDiaBrl: async () => 0, tetoDiarioBrl: async () => 20 });
    expect(primeira.noticiasNovas).toBe(2);
    const segunda = await coletarNoticiasDosAssuntos({ agora: AGORA, baixar: baixarSo({ [urlDoGoogleNews("epsilon")]: outroEndereco, [urlDoGoogleNews("zeta")]: outroEndereco }), buscarPagina, gastoDoDiaBrl: async () => 0, tetoDiarioBrl: async () => 20 });
    expect(segunda.noticiasNovas).toBe(0);
    // Duas linhas guardadas (uma por assunto), mas o roteiro recebe a manchete uma vez só.
    const fonte = await noticiasDeHojeDosAssuntos(marcaE, "epsilon e zeta", AGORA);
    expect(fonte).toHaveLength(1);
  });

  it("endereço que não é https, com credencial ou com IP direto nunca é gravado; a foto também", async () => {
    const marcaF = await novaMarca("marca-endereco");
    const assunto = await adicionarAssunto(marcaF, "eta");
    const feed = new TextEncoder().encode(
      `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>x</title>` +
        `<item><title>Eta ruim 1 - V</title><link>http://exemplo.com.br/a</link><pubDate>Tue, 06 Oct 2026 12:00:00 GMT</pubDate></item>` +
        `<item><title>Eta ruim 2 - V</title><link>https://usuario:senha@exemplo.com.br/a</link><pubDate>Tue, 06 Oct 2026 12:00:00 GMT</pubDate></item>` +
        `<item><title>Eta ruim 3 - V</title><link>https://10.0.0.5/a</link><pubDate>Tue, 06 Oct 2026 12:00:00 GMT</pubDate></item>` +
        `<item><title>Eta ruim 4 - V</title><link>https://redir.exemplo.com.br/x/*http://roteiros-postgres:5432/</link><pubDate>Tue, 06 Oct 2026 12:00:00 GMT</pubDate></item>` +
        `<item><title>Eta boa - V</title><link>https://news.google.com/rss/articles/eta-boa</link><media:content url="http://exemplo.com.br/foto.jpg"/><pubDate>Tue, 06 Oct 2026 12:00:00 GMT</pubDate></item>` +
        `</channel></rss>`,
    );
    const resumo = await coletarNoticiasDosAssuntos({ agora: AGORA, baixar: baixarSo({ [urlDoGoogleNews("eta")]: feed }), buscarPagina, gastoDoDiaBrl: async () => 0, tetoDiarioBrl: async () => 20 });
    expect(resumo.noticiasNovas).toBe(1);
    const [guardada] = await db().select().from(noticiasDoAssunto).where(eq(noticiasDoAssunto.assuntoId, assunto.id));
    expect(guardada).toMatchObject({ titulo: "Eta boa", url: "https://news.google.com/rss/articles/eta-boa", imagemUrl: null, imagemCredito: null });
  });

  it("o assunto: marca que não existe vira ErroAssunto, o banco recusa o repetido com outra caixa e dois pedidos ao mesmo tempo não passam de cinco", async () => {
    await expect(adicionarAssunto(999_999, "qualquer")).rejects.toThrow("essa marca não existe");

    const marcaG = await novaMarca("marca-concorrente");
    await adicionarAssunto(marcaG, "Teta");
    await expect(db().insert(assuntosDaMarca).values({ clienteId: marcaG, texto: "teta" })).rejects.toThrow();

    const resultados = await Promise.allSettled(["a1", "a2", "a3", "a4", "a5", "a6", "a7"].map((t) => adicionarAssunto(marcaG, t)));
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    expect(await assuntosAtivosDaMarca(marcaG)).toHaveLength(5);
  });
});
