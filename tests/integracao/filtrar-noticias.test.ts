/**
 * O filtro das notícias do ramo e a foto da matéria (fix de 22/10/2026, Notícias), contra o Postgres real e o pg-boss real, em mock e SEM rede (a busca da foto entra por parâmetro):
 *  - o ramo de uma marca recém-chegada entra no filtro no mesmo dia (briefing terminado, conta criada pelo admin) e o ramo parado, sem marca ativa, fica de fora da rodada de depois da coleta;
 *  - notícia publicada há mais de 7 dias, ou sem data, nunca é candidata nem aparece na lista;
 *  - a foto da matéria é guardada, o crédito é o do veículo, a rota serve só a quem é do setor, e sem sessão recusa;
 *  - foto que não vem fica `sem_foto`, volta uma vez só, e o cartão cai no quadro com o nome do veículo.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ sessao: null as { user: { id: string; role: string } } | null }));
vi.mock("@/lib/sessao", () => ({ sessaoAtual: async () => estado.sessao }));

import { GET } from "@/app/api/imagem-noticia/[id]/route";
import { perguntasDoBriefing } from "@/config/briefing";
import { db, getPool } from "@/db";
import { clientes, geracoesIA, imagensNoticia, membrosMarca, nichos, noticias, user } from "@/db/schema";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { apagarFotosVelhas, ramosParaOFiltro, rodarFiltroDeNoticias } from "@/jobs/filtrar-noticias";
import type { ResultadoDaFoto } from "@/jobs/foto-da-materia";
import { avaliarResposta } from "@/servicos/briefing";
import { criarMarca } from "@/servicos/clientes";
import { candidatasDoRamo, pedirFiltroDeNoticias } from "@/servicos/filtro-de-noticias";
import { fotoGuardadaDaNoticia } from "@/servicos/foto-da-noticia";
import { noticiasDoSetor } from "@/servicos/noticias";
import { capaDoDia } from "@/servicos/noticias-do-dia";

import { resetarSchema } from "../../scripts/resetar-schema";

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const AGORA = new Date();

let ramoNovoId: number;
let ramoParadoId: number;
let ramoSemMarcaId: number;
let marcaNovaId: number;
let marcaParadaId: number;
let sequencia = 0;

const JPEG = new Uint8Array(6_000).fill(7);
JPEG.set([0xff, 0xd8, 0xff, 0xe0]);

async function noticia(nichoId: number, titulo: string, extra: Partial<typeof noticias.$inferInsert> = {}): Promise<number> {
  sequencia += 1;
  const [linha] = await db()
    .insert(noticias)
    .values({ nichoId, titulo, url: `https://news.google.com/rss/articles/NOTICIA${sequencia}?oc=5`, fonte: "G1", publicadoEm: new Date(AGORA.getTime() - 2 * HORA), coletadoEm: new Date(AGORA.getTime() - HORA), ...extra })
    .returning({ id: noticias.id });
  return linha.id;
}

async function relevanteDe(id: number): Promise<boolean | null> {
  const [linha] = await db().select({ relevante: noticias.relevante }).from(noticias).where(eq(noticias.id, id));
  return linha.relevante;
}

async function jobsDoRamo(nichoId: number): Promise<number> {
  const r = await db().execute(sql`select count(*)::int as total from pgboss.job where name = ${FILAS.filtrarNoticias} and (data ->> 'nichoId')::int = ${nichoId}`);
  return Number((r.rows[0] as { total: number }).total);
}

async function limparFila(): Promise<void> {
  await db().execute(sql`delete from pgboss.job where name = ${FILAS.filtrarNoticias}`);
}

const fotoOk = async (): Promise<ResultadoDaFoto> => ({ situacao: "guardada", bytes: JPEG, tipo: "image/jpeg", origem: "https://s2-g1.glbimg.com/f.jpg" });

beforeAll(async () => {
  await resetarSchema(db());
  await garantirBossPronto();
  const [a, b, c] = await db()
    .insert(nichos)
    .values([
      { slug: "filtro-ramo-novo", nome: "Empreendedorismo e Construção de Marcas", termos: ["empreendedorismo"] },
      { slug: "filtro-ramo-parado", nome: "Ramo parado", termos: ["parado"] },
      { slug: "filtro-ramo-sem-marca", nome: "Ramo sem marca", termos: ["sem marca"] },
    ])
    .returning();
  ramoNovoId = a.id;
  ramoParadoId = b.id;
  ramoSemMarcaId = c.id;
  await db().insert(user).values([
    { id: "filtro-novo", name: "[teste] Novo", email: "novo@filtro.teste" },
    { id: "filtro-parado", name: "[teste] Parado", email: "parado@filtro.teste" },
    { id: "filtro-outro", name: "[teste] Outro", email: "outro@filtro.teste" },
  ]);
  // A marca que chegou hoje, e a que chegou há 30 dias e não aparece há 20.
  const [novo, parado] = await db()
    .insert(clientes)
    .values([
      { usuarioId: "filtro-novo", nome: "[teste] Marca nova", nichoId: ramoNovoId },
      { usuarioId: "filtro-parado", nome: "[teste] Marca parada", nichoId: ramoParadoId, criadoEm: new Date(AGORA.getTime() - 30 * DIA), ultimoAcessoEm: new Date(AGORA.getTime() - 20 * DIA) },
    ])
    .returning();
  marcaNovaId = novo.id;
  marcaParadaId = parado.id;
  await db().insert(membrosMarca).values([
    { usuarioId: "filtro-novo", clienteId: novo.id, papel: "dono" },
    { usuarioId: "filtro-parado", clienteId: parado.id, papel: "dono" },
  ]);
}, 60_000);

beforeEach(async () => {
  await db().delete(noticias);
  await db().delete(geracoesIA);
  await limparFila();
});

afterEach(limparFila);

afterAll(async () => {
  await limparFila();
  await boss().stop({ graceful: false });
  await getPool().end();
});

describe("quais ramos entram na rodada de depois da coleta", () => {
  it("o ramo da marca recém-chegada entra; o da marca parada há semanas e o ramo sem marca ficam de fora", async () => {
    const ids = (await ramosParaOFiltro(AGORA)).map((r) => r.id);
    expect(ids).toContain(ramoNovoId);
    expect(ids).not.toContain(ramoParadoId);
    expect(ids).not.toContain(ramoSemMarcaId);
  });

  it("a marca parada que abre o aplicativo volta a entrar", async () => {
    await db().update(clientes).set({ ultimoAcessoEm: AGORA }).where(eq(clientes.id, marcaParadaId));
    expect((await ramosParaOFiltro(AGORA)).map((r) => r.id)).toContain(ramoParadoId);
    await db().update(clientes).set({ ultimoAcessoEm: new Date(AGORA.getTime() - 20 * DIA) }).where(eq(clientes.id, marcaParadaId));
  });
});

describe("notícia velha ou sem data nunca é candidata nem aparece", () => {
  it("o filtro só vê as dos últimos 7 dias; a de 30 dias e a sem data ficam sem veredito", async () => {
    const recente = await noticia(ramoNovoId, "Recente de hoje");
    const seisDias = await noticia(ramoNovoId, "De seis dias", { publicadoEm: new Date(AGORA.getTime() - 6 * DIA) });
    const velha = await noticia(ramoNovoId, "De dezembro", { publicadoEm: new Date(AGORA.getTime() - 30 * DIA) });
    const semData = await noticia(ramoNovoId, "Sem data", { publicadoEm: null });

    expect((await candidatasDoRamo(ramoNovoId, { agora: AGORA })).map((c) => c.id).sort()).toEqual([recente, seisDias].sort());

    const resumo = await rodarFiltroDeNoticias(ramoNovoId, { agora: AGORA, foto: fotoOk });
    expect(resumo).toMatchObject({ ramos: 1, lotes: 1, candidatas: 2 });
    expect(await relevanteDe(recente)).toBe(true);
    expect(await relevanteDe(seisDias)).toBe(true);
    expect(await relevanteDe(velha)).toBeNull();
    expect(await relevanteDe(semData)).toBeNull();
  });

  it("a velha e a sem data, mesmo marcadas relevantes, não aparecem na lista nem em nenhum período", async () => {
    const velha = await noticia(ramoNovoId, "De dezembro, relevante", { publicadoEm: new Date(AGORA.getTime() - 30 * DIA), relevante: true });
    await noticia(ramoNovoId, "Sem data, relevante", { publicadoEm: null, relevante: true });
    const recente = await noticia(ramoNovoId, "Recente, relevante", { relevante: true });
    for (const periodo of ["hoje", "semana", "mes"] as const) {
      const ids = (await noticiasDoSetor(ramoNovoId, marcaNovaId, periodo, AGORA)).map((n) => n.id);
      expect(ids, periodo).toEqual([recente]);
      expect(ids).not.toContain(velha);
    }
  });

  it("sem candidata nenhuma, nenhuma chamada de IA", async () => {
    await noticia(ramoNovoId, "De dezembro", { publicadoEm: new Date(AGORA.getTime() - 30 * DIA) });
    const resumo = await rodarFiltroDeNoticias(ramoNovoId, { agora: AGORA, foto: fotoOk });
    expect(resumo).toMatchObject({ lotes: 0, candidatas: 0 });
    expect(await db().select().from(geracoesIA)).toHaveLength(0);
  });
});

describe("o ramo novo recebe o filtro no mesmo dia", () => {
  it("a rodada sem ramo filtra o ramo da marca recém-chegada e não toca o ramo parado", async () => {
    const doNovo = await noticia(ramoNovoId, "Do ramo novo");
    const doParado = await noticia(ramoParadoId, "Do ramo parado");
    const resumo = await rodarFiltroDeNoticias(undefined, { agora: AGORA, foto: fotoOk });
    expect(resumo.ramos).toBe(1);
    expect(await relevanteDe(doNovo)).toBe(true);
    expect(await relevanteDe(doParado)).toBeNull();
    const geracoes = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "filtrarNoticias"));
    expect(geracoes).toHaveLength(1);
  });

  it("conta criada pelo admin num ramo enfileira o filtro daquele ramo, uma vez só (singleton por ramo)", async () => {
    await criarMarca({ nome: "[teste] Conta do admin", nichoId: ramoSemMarcaId });
    await expect.poll(() => jobsDoRamo(ramoSemMarcaId), { timeout: 5_000, interval: 50 }).toBe(1);
    await pedirFiltroDeNoticias(ramoSemMarcaId);
    await pedirFiltroDeNoticias(ramoSemMarcaId);
    expect(await jobsDoRamo(ramoSemMarcaId)).toBe(1);
  });

  it("terminar o briefing enfileira o filtro do ramo da marca", async () => {
    const [marca] = await db().insert(clientes).values({ usuarioId: "filtro-outro", nome: "[teste] Marca do briefing", nichoId: ramoParadoId }).returning();
    for (const pergunta of perguntasDoBriefing("negocio")) {
      await avaliarResposta(marca.id, pergunta.id, `Resposta concreta para ${pergunta.id}, com o numero 42 na frase, a fala real do cliente "isso resolveu o meu problema", e uma mencao ao bairro de Pinheiros para dar contexto.`, "negocio");
    }
    await expect.poll(() => jobsDoRamo(ramoParadoId), { timeout: 5_000, interval: 50 }).toBe(1);
  });
});

describe("a foto da matéria", () => {
  it("é guardada, leva o crédito do veículo, entra na lista da tela e a rota serve só a quem é do setor", async () => {
    const id = await noticia(ramoNovoId, "Matéria com foto");
    const buscadas: string[] = [];
    const resumo = await rodarFiltroDeNoticias(ramoNovoId, {
      agora: AGORA,
      foto: async (link) => {
        buscadas.push(link);
        return fotoOk();
      },
      esperar: async () => undefined,
    });
    expect(resumo.fotos).toMatchObject({ tentadas: 1, guardadas: 1, semFoto: 0 });
    expect(buscadas).toHaveLength(1);

    const [guardada] = await db().select().from(imagensNoticia).where(eq(imagensNoticia.noticiaId, id));
    expect(guardada).toMatchObject({ situacao: "guardada", tipo: "image/jpeg" });
    expect(guardada.bytes?.length).toBe(6_000);
    const [linha] = await db().select({ credito: noticias.imagemCredito }).from(noticias).where(eq(noticias.id, id));
    expect(linha.credito).toBe("Foto: G1");

    const lista = await noticiasDoSetor(ramoNovoId, marcaNovaId, "semana", AGORA);
    expect(lista[0]).toMatchObject({ id, fotoGuardada: true });

    const capa = await capaDoDia({ id: marcaNovaId, nichoId: ramoNovoId }, AGORA);
    const naCapa = [...capa.deHoje, ...capa.deOntem].find((n) => n.noticiaId === id);
    expect(naCapa).toMatchObject({ imagemUrl: `/api/imagem-noticia/${id}`, imagemCredito: "Foto: G1" });

    // Quem tem marca no setor recebe os bytes; quem é de outro setor, não; o admin vê tudo; foto que não existe é nula.
    const doSetor = await fotoGuardadaDaNoticia(id, { id: "filtro-novo", role: "cliente" });
    expect(doSetor).toMatchObject({ tipo: "image/jpeg" });
    expect(await fotoGuardadaDaNoticia(id, { id: "filtro-parado", role: "cliente" })).toBe("negado");
    expect(await fotoGuardadaDaNoticia(id, { id: "ninguem", role: "admin" })).toMatchObject({ tipo: "image/jpeg" });
    expect(await fotoGuardadaDaNoticia(id + 999, { id: "filtro-novo", role: "cliente" })).toBeNull();
  });

  it("a rota recusa sem sessão (401) e serve com sessão, com o tipo certo e sem deixar o navegador adivinhar", async () => {
    const id = await noticia(ramoNovoId, "Matéria da rota");
    await rodarFiltroDeNoticias(ramoNovoId, { agora: AGORA, foto: fotoOk, esperar: async () => undefined });

    const pedido = (n: number) => GET(new Request(`http://localhost/api/imagem-noticia/${n}`), { params: Promise.resolve({ id: String(n) }) });

    estado.sessao = null;
    expect((await pedido(id)).status).toBe(401);

    estado.sessao = { user: { id: "filtro-novo", role: "cliente" } };
    const ok = await pedido(id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("cache-control")).toContain("private");
    expect((await ok.arrayBuffer()).byteLength).toBe(6_000);

    estado.sessao = { user: { id: "filtro-parado", role: "cliente" } };
    expect((await pedido(id)).status).toBe(403);
    estado.sessao = { user: { id: "filtro-novo", role: "cliente" } };
    expect((await pedido(id + 999)).status).toBe(404);
    expect((await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "abc" }) })).status).toBe(404);
    estado.sessao = null;
  });

  it("sem foto que sirva: a página sem foto é definitiva; a falha de rede volta uma vez só, três horas depois", async () => {
    const semFoto = await noticia(ramoNovoId, "Página sem foto");
    await noticia(ramoNovoId, "Rede caiu");
    const tentativas: Record<string, number> = {};
    const foto = async (link: string): Promise<ResultadoDaFoto> => {
      tentativas[link] = (tentativas[link] ?? 0) + 1;
      const [n] = await db().select({ id: noticias.id }).from(noticias).where(eq(noticias.url, link));
      return n.id === semFoto
        ? { situacao: "sem_foto", motivo: "pagina_sem_foto", passageiro: false }
        : { situacao: "sem_foto", motivo: "pagina_nao_abriu", passageiro: true };
    };
    const rodar = (agora: Date) => rodarFiltroDeNoticias(ramoNovoId, { agora, foto, esperar: async () => undefined });

    const primeira = await rodar(AGORA);
    expect(primeira.fotos).toMatchObject({ tentadas: 2, guardadas: 0, semFoto: 2 });

    // Uma hora depois nada volta; três horas depois só a que foi a rede, e só dessa vez.
    const umaHora = await rodar(new Date(AGORA.getTime() + HORA));
    expect(umaHora.fotos).toMatchObject({ tentadas: 0 });
    const quatroHoras = await rodar(new Date(AGORA.getTime() + 4 * HORA));
    expect(quatroHoras.fotos).toMatchObject({ tentadas: 1 });
    const depois = await rodar(new Date(AGORA.getTime() + 8 * HORA));
    expect(depois.fotos).toMatchObject({ tentadas: 0 });

    const linhas = await db().select().from(imagensNoticia);
    expect(linhas.every((l) => l.situacao === "sem_foto" && l.bytes === null)).toBe(true);
    expect(Object.values(tentativas).sort()).toEqual([1, 2]);

    // E a lista e a capa continuam sem foto: o cartão cai no quadro com o nome do veículo.
    const capa = await capaDoDia({ id: marcaNovaId, nichoId: ramoNovoId }, AGORA);
    const semFotoNaCapa = [...capa.deHoje, ...capa.deOntem].find((n) => n.noticiaId === semFoto);
    expect(semFotoNaCapa).toMatchObject({ imagemUrl: null, imagemCredito: null, veiculo: "G1" });
  });

  it("a notícia que o feed do portal já deu foto não busca outra, e a velha de 14 dias é apagada", async () => {
    const comFoto = await noticia(ramoNovoId, "Foto do feed", { imagemUrl: "https://s2-g1.glbimg.com/feed.jpg", imagemCredito: "Foto: G1" });
    let chamadas = 0;
    await rodarFiltroDeNoticias(ramoNovoId, { agora: AGORA, foto: async () => { chamadas += 1; return fotoOk(); }, esperar: async () => undefined });
    expect(chamadas).toBe(0);
    expect(await db().select().from(imagensNoticia).where(eq(imagensNoticia.noticiaId, comFoto))).toHaveLength(0);

    const velha = await noticia(ramoNovoId, "Foto velha", { relevante: true });
    await db().insert(imagensNoticia).values({ noticiaId: velha, situacao: "guardada", tipo: "image/jpeg", bytes: Buffer.from(JPEG), criadoEm: new Date(AGORA.getTime() - 15 * DIA) });
    expect(await apagarFotosVelhas(AGORA)).toBe(1);
  });
});
