/**
 * E17 parte 1, a busca por significado sem chave: o job que guarda os vetores (tetos, retomada, ficha mudada, custo registrado), a busca com a porta simulada (o mais parecido vem
 * primeiro, todos os filtros de hoje continuam valendo, cai para o texto quando a porta falha) e o desligado (nada muda para ninguem).
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { contas, custosExternos, DIMENSOES_DO_VETOR, embeddingsVideo, nichos, videos } from "@/db/schema";
import { rodarEmbedarVideos } from "@/jobs/embedar-videos";
import { config } from "@/lib/config";
import { criarPortaSimulada, ErroEmbeddings, usarPortaEmbeddings, vetorSimulado, type PortaEmbeddings } from "@/lib/embeddings";
import { vizinhosPorSignificado } from "@/servicos/busca-por-significado";
import { evidenciaParaTema } from "@/servicos/pesquisa";
import { gastoDeHojeUsd, preencherVetores } from "@/servicos/vetores-dos-videos";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
const diasAtras = (dias: number) => new Date(Date.now() - dias * DIA_MS);

let setorA: number;
let setorB: number;
let contaA: number;
let contaB: number;

type Ficha = { titulo: string; assunto: string; gancho?: string; etiquetas?: string[] };

async function criarVideo(idExterno: string, ficha: Ficha | null, opcoes: { setor?: number; dias?: number; foraDaCurva?: number; origem?: "coleta" | "seed" } = {}) {
  const setor = opcoes.setor ?? setorA;
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: "tiktok",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      contaId: setor === setorA ? contaA : contaB,
      nichoId: setor,
      titulo: ficha?.titulo ?? "sem analise",
      views: 100,
      publicadoEm: diasAtras(opcoes.dias ?? 5),
      origem: opcoes.origem ?? "coleta",
      foraDaCurva: String(opcoes.foraDaCurva ?? 3),
      analise: ficha ? ({ assunto: ficha.assunto, gancho: ficha.gancho ?? "" } as never) : undefined,
      etiquetas: ficha?.etiquetas ?? [],
      idioma: "pt",
    })
    .returning();
  return v;
}

async function zerar() {
  await db().delete(embeddingsVideo);
  await db().delete(custosExternos);
  await db().delete(videos);
}

/** Uma porta que conta as chamadas (e, se pedirem, falha na enesima). */
function portaEspia(opcoes: { falharNaChamada?: number; tokensPorChamada?: number } = {}): PortaEmbeddings & { chamadas: { textos: string[]; tipo: string }[] } {
  const base = criarPortaSimulada();
  const chamadas: { textos: string[]; tipo: string }[] = [];
  return {
    ...base,
    chamadas,
    async embedar(textos, tipo) {
      chamadas.push({ textos, tipo });
      if (opcoes.falharNaChamada === chamadas.length) throw new ErroEmbeddings("a API caiu (simulado)");
      const r = await base.embedar(textos, tipo);
      return opcoes.tokensPorChamada ? { ...r, tokens: opcoes.tokensPorChamada } : r;
    },
  };
}

beforeAll(async () => {
  await resetarSchema(db());
  const [a] = await db().insert(nichos).values({ slug: "significado-a", nome: "Significado A", termos: [] }).returning();
  const [b] = await db().insert(nichos).values({ slug: "significado-b", nome: "Significado B", termos: [] }).returning();
  setorA = a.id;
  setorB = b.id;
  const [ca] = await db().insert(contas).values({ plataforma: "tiktok", handle: "conta-significado-a", nichoId: setorA }).returning();
  const [cb] = await db().insert(contas).values({ plataforma: "tiktok", handle: "conta-significado-b", nichoId: setorB }).returning();
  contaA = ca.id;
  contaB = cb.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(() => {
  usarPortaEmbeddings();
  config.embeddings.buscaAtiva = false;
  config.embeddings.preencher = false;
  vi.unstubAllEnvs();
});

describe("a extensao e a tabela (migracao 0094)", () => {
  it("o banco tem o pgvector e a tabela de vetores guarda 1024 numeros", async () => {
    const ext = await db().execute<{ extname: string }>(sql`select extname from pg_extension where extname = 'vector'`);
    expect(ext.rows).toHaveLength(1);
    expect(DIMENSOES_DO_VETOR).toBe(1024);
    const tipo = await db().execute<{ tipo: string }>(sql`select format_type(atttypid, atttypmod) as tipo from pg_attribute where attrelid = 'embeddings_video'::regclass and attname = 'vetor'`);
    expect(tipo.rows[0].tipo).toBe("vector(1024)");
  });

  it("apagar o video apaga o vetor (on delete cascade)", async () => {
    await zerar();
    const v = await criarVideo("cascata", { titulo: "x", assunto: "assunto de teste" });
    await db().insert(embeddingsVideo).values({ videoId: v.id, modelo: "simulado-v1", fichaHash: "h", vetor: vetorSimulado("assunto de teste") });
    await db().delete(videos).where(eq(videos.id, v.id));
    const sobrou = await db().select().from(embeddingsVideo);
    expect(sobrou).toHaveLength(0);
  });
});

describe("o job embedar-videos", () => {
  beforeEach(zerar);

  async function seisVideos() {
    // Os tres mais novos primeiro; um sem analise, um velho demais e um de seed ficam de fora.
    const ids: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const v = await criarVideo(`job-${i}`, { titulo: `titulo numero ${i}`, assunto: `assunto numero ${i} de clareamento`, gancho: `gancho ${i}` }, { dias: i });
      ids.push(v.id);
    }
    await criarVideo("job-sem-analise", null, { dias: 1 });
    await criarVideo("job-velho", { titulo: "velho", assunto: "assunto velho" }, { dias: 120 });
    await criarVideo("job-seed", { titulo: "seed", assunto: "assunto de seed" }, { dias: 1, origem: "seed" });
    return ids;
  }

  it("desligado por padrao: nao faz nada e nem chama a porta", async () => {
    await seisVideos();
    const porta = portaEspia();
    usarPortaEmbeddings(porta);
    const resumo = await rodarEmbedarVideos();
    expect(resumo).toMatchObject({ desligado: true });
    expect(porta.chamadas).toHaveLength(0);
    expect(await db().select().from(embeddingsVideo)).toHaveLength(0);
    expect(await db().select().from(custosExternos)).toHaveLength(0);
  });

  it("ligado: guarda so o que e analisado, recente e nao e seed; os mais novos primeiro; custo registrado", async () => {
    const ids = await seisVideos();
    const porta = portaEspia();
    const resumo = await rodarEmbedarVideos({ ligado: true, porta, videosPorRodada: 3, textosPorChamada: 2 });

    expect(resumo).toMatchObject({ elegiveis: 5, precisavam: 5, gravados: 3, parouPor: "teto_por_rodada" });
    // Os tres mais novos (dias 1, 2 e 3), em dois lotes (2 + 1).
    const guardados = (await db().select({ videoId: embeddingsVideo.videoId }).from(embeddingsVideo)).map((l) => l.videoId).sort((x, y) => x - y);
    expect(guardados).toEqual(ids.slice(0, 3));
    expect(porta.chamadas.map((c) => c.textos.length)).toEqual([2, 1]);
    expect(porta.chamadas.every((c) => c.tipo === "documento")).toBe(true);

    const custos = await db().select().from(custosExternos);
    expect(custos).toHaveLength(2);
    expect(custos.every((c) => c.fonte === "voyage" && c.unidade === "tokens" && c.origemDoCusto === "estimado")).toBe(true);
    expect(custos.reduce((soma, c) => soma + Number(c.unidades), 0)).toBe(resumo.tokens);
  });

  it("retoma de onde parou: a rodada seguinte pega o resto e a ultima nao tem nada a fazer", async () => {
    await seisVideos();
    const porta = portaEspia();
    const opcoes = { ligado: true, porta, videosPorRodada: 3 };
    expect((await rodarEmbedarVideos(opcoes)).gravados).toBe(3);
    const segunda = await rodarEmbedarVideos(opcoes);
    expect(segunda).toMatchObject({ jaTinham: 3, precisavam: 2, gravados: 2, parouPor: "concluido" });
    const terceira = await rodarEmbedarVideos(opcoes);
    expect(terceira).toMatchObject({ gravados: 0, parouPor: "nada_a_fazer" });
    expect(await db().select().from(embeddingsVideo)).toHaveLength(5);
  });

  it("para na primeira falha da API, guarda o que ja tinha ido e a rodada seguinte conclui", async () => {
    await seisVideos();
    const quebrada = portaEspia({ falharNaChamada: 2 });
    const resumo = await rodarEmbedarVideos({ ligado: true, porta: quebrada, textosPorChamada: 2 });
    expect(resumo).toMatchObject({ gravados: 2, parouPor: "falha" });
    expect(String(resumo.erro)).toContain("a API caiu");
    expect(quebrada.chamadas).toHaveLength(2); // nao insistiu nos lotes seguintes
    expect(await db().select().from(embeddingsVideo)).toHaveLength(2);

    const sadia = portaEspia();
    const retomada = await rodarEmbedarVideos({ ligado: true, porta: sadia });
    expect(retomada).toMatchObject({ gravados: 3, parouPor: "concluido" });
    expect(await db().select().from(embeddingsVideo)).toHaveLength(5);
  });

  it("ficha mudada refaz o vetor so daquele video", async () => {
    const ids = await seisVideos();
    await rodarEmbedarVideos({ ligado: true, porta: portaEspia() });
    const antes = await db().select().from(embeddingsVideo).where(eq(embeddingsVideo.videoId, ids[0]));

    await db().update(videos).set({ analise: { assunto: "um assunto totalmente novo de gengiva", gancho: "novo" } as never }).where(eq(videos.id, ids[0]));
    const resumo = await rodarEmbedarVideos({ ligado: true, porta: portaEspia() });

    expect(resumo).toMatchObject({ precisavam: 1, gravados: 1 });
    const depois = await db().select().from(embeddingsVideo).where(eq(embeddingsVideo.videoId, ids[0]));
    expect(depois[0].fichaHash).not.toBe(antes[0].fichaHash);
    expect(depois[0].vetor).not.toEqual(antes[0].vetor);
    expect(await db().select().from(embeddingsVideo)).toHaveLength(5); // atualizou, nao duplicou
  });

  it("teto de dolar: o que ja foi gasto hoje conta, o de ontem nao", async () => {
    await seisVideos();
    await db().insert(custosExternos).values({ fonte: "voyage", custoUsd: "5.000000", unidades: "1", unidade: "tokens", origemDoCusto: "estimado", criadoEm: new Date(Date.now() - 2 * DIA_MS) });
    expect(await gastoDeHojeUsd(new Date())).toBe(0);
    const comOTetoDeOntem = await rodarEmbedarVideos({ ligado: true, porta: portaEspia(), tetoUsdPorDia: 1 });
    expect(comOTetoDeOntem).toMatchObject({ gravados: 5, parouPor: "concluido" });

    await zerar();
    await seisVideos();
    await db().insert(custosExternos).values({ fonte: "voyage", custoUsd: "1.000000", unidades: "1", unidade: "tokens", origemDoCusto: "estimado" });
    const porta = portaEspia();
    const bloqueado = await rodarEmbedarVideos({ ligado: true, porta, tetoUsdPorDia: 1 });
    expect(bloqueado).toMatchObject({ gravados: 0, parouPor: "teto_de_dolar" });
    expect(porta.chamadas).toHaveLength(0);
  });

  it("teto de dolar no meio da rodada: para no lote que passaria do teto", async () => {
    await seisVideos();
    // Cada lote custa US$ 0,06 (1 milhao de tokens a US$ 0,06). Teto de US$ 0,10: o primeiro lote passa, o segundo ainda cabe na conta antes de chamar, o terceiro nao.
    const porta = portaEspia({ tokensPorChamada: 1_000_000 });
    const resumo = await rodarEmbedarVideos({ ligado: true, porta, tetoUsdPorDia: 0.1, textosPorChamada: 1 });
    expect(resumo).toMatchObject({ gravados: 2, parouPor: "teto_de_dolar" });
    expect(porta.chamadas).toHaveLength(2);
    expect(await gastoDeHojeUsd(new Date())).toBeCloseTo(0.12, 6);
  });

  it("recusa gravar vetor simulado em producao", async () => {
    await seisVideos();
    vi.stubEnv("NODE_ENV", "production");
    await expect(preencherVetores({ porta: portaEspia() })).rejects.toThrow(/simulado em producao/);
    expect(await db().select().from(embeddingsVideo)).toHaveLength(0);
  });
});

describe("a busca por significado", () => {
  const TEMA = "clareamento dental manchas amarelas rapido";
  let v1: number;
  let v1b: number;

  beforeEach(async () => {
    await zerar();
    // O tema tem "rapido", que nenhum video tem: a busca por texto (todas as palavras) nao acha nada; so o significado acha.
    const a = await criarVideo("s-1", { titulo: "Clareamento dental em casa", assunto: "tirar manchas amarelas dos dentes com clareamento dental", gancho: "seus dentes amarelos tem solucao" }, { foraDaCurva: 3 });
    const b = await criarVideo("s-1b", { titulo: "Sorriso branco", assunto: "clareamento dental caseiro sem dor", gancho: "vale a pena" }, { foraDaCurva: 40 });
    await criarVideo("s-2", { titulo: "Receita de bolo de cenoura", assunto: "bolo de cenoura fofinho", gancho: "o segredo da cobertura" }, { foraDaCurva: 90 });
    await criarVideo("s-outro-setor", { titulo: "Clareamento dental em casa", assunto: "tirar manchas amarelas dos dentes com clareamento dental", gancho: "seus dentes amarelos tem solucao" }, { setor: setorB });
    v1 = a.id;
    v1b = b.id;
    usarPortaEmbeddings(portaEspia());
    await rodarEmbedarVideos({ ligado: true });
  });

  it("desligada (o padrao): a evidencia e a de sempre, so por texto, e a porta nem e chamada", async () => {
    const porta = portaEspia();
    usarPortaEmbeddings(porta);
    expect(config.embeddings.buscaAtiva).toBe(false);
    const resultado = await evidenciaParaTema(setorA, TEMA);
    expect(resultado).toEqual([]);
    expect(porta.chamadas).toHaveLength(0);
  });

  it("ligada: acha por significado o que o texto nao achou, o mais parecido primeiro, so do setor, mesmo com outro de fora da curva maior", async () => {
    config.embeddings.buscaAtiva = true;
    const porta = portaEspia();
    usarPortaEmbeddings(porta);

    const resultado = await evidenciaParaTema(setorA, TEMA);

    expect(porta.chamadas).toHaveLength(1);
    expect(porta.chamadas[0]).toEqual({ textos: [TEMA], tipo: "consulta" });
    // O bolo de cenoura (fora da curva 90) nao e parecido e fica de fora; o do outro setor tambem. v1 e mais parecido que v1b, mesmo v1b tendo fora da curva 40 contra 3.
    expect(resultado.map((v) => v.id)).toEqual([v1, v1b]);
    expect(resultado.every((v) => v.nichoId === setorA)).toBe(true);
  });

  it("soma, nao substitui: o que a busca por texto acha continua vindo", async () => {
    config.embeddings.buscaAtiva = true;
    usarPortaEmbeddings(portaEspia());
    const porTexto = await criarVideo("s-texto", { titulo: "Gengivite", assunto: "como cuidar da gengivite e do sangramento", gancho: "x", etiquetas: ["gengivite"] }, { foraDaCurva: 5 });
    const resultado = await evidenciaParaTema(setorA, "gengivite sangramento clareamento dental manchas amarelas rapido");
    const ids = resultado.map((v) => v.id);
    expect(ids).toContain(porTexto.id);
    expect(ids).toContain(v1);
  });

  it("os filtros de hoje continuam valendo: video velho, sem analise e de seed nunca entram, mesmo com vetor", async () => {
    config.embeddings.buscaAtiva = true;
    usarPortaEmbeddings(portaEspia());
    const igual = { titulo: "Clareamento dental em casa", assunto: "tirar manchas amarelas dos dentes com clareamento dental", gancho: "seus dentes amarelos tem solucao" };
    const velho = await criarVideo("s-velho", igual, { dias: 120 });
    const semAnalise = await criarVideo("s-sem-analise", null);
    const seed = await criarVideo("s-seed", igual, { origem: "seed" });
    for (const v of [velho, semAnalise, seed]) {
      await db().insert(embeddingsVideo).values({ videoId: v.id, modelo: "simulado-v1", fichaHash: "h", vetor: vetorSimulado(`${igual.titulo}\n${igual.assunto}\n${igual.gancho}`) });
    }
    const resultado = await evidenciaParaTema(setorA, TEMA);
    expect(resultado.map((v) => v.id)).toEqual([v1, v1b]);
  });

  it("sem vetor nenhum cai para a busca por texto, sem erro", async () => {
    config.embeddings.buscaAtiva = true;
    await db().delete(embeddingsVideo);
    usarPortaEmbeddings(portaEspia());
    expect(await evidenciaParaTema(setorA, TEMA)).toEqual([]);
    const porTexto = await evidenciaParaTema(setorA, "clareamento dental");
    expect(porTexto.map((v) => v.id).sort()).toEqual([v1, v1b].sort());
  });

  it("se a porta falhar, a evidencia sai so por texto e nada quebra", async () => {
    config.embeddings.buscaAtiva = true;
    usarPortaEmbeddings({ ...criarPortaSimulada(), embedar: async () => Promise.reject(new ErroEmbeddings("fora do ar")) });
    expect(await evidenciaParaTema(setorA, TEMA)).toEqual([]);
    const porTexto = await evidenciaParaTema(setorA, "clareamento dental");
    expect(porTexto.length).toBe(2);
  });

  it("vizinhosPorSignificado respeita o limite de vizinhos e a distancia maxima", async () => {
    usarPortaEmbeddings(portaEspia());
    const base = [sql`${videos.nichoId} = ${setorA}`];
    const todos = await vizinhosPorSignificado(TEMA, base, { ativa: true, vizinhos: 10, distanciaMax: 0.9 });
    expect(todos[0]).toBe(v1);
    expect(await vizinhosPorSignificado(TEMA, base, { ativa: true, vizinhos: 1 })).toEqual([v1]);
    expect(await vizinhosPorSignificado(TEMA, base, { ativa: true, distanciaMax: 0.0001 })).toEqual([]);
    expect(await vizinhosPorSignificado("   ", base, { ativa: true })).toEqual([]);
  });

  it("a consulta registra o custo da busca (fonte voyage, tokens)", async () => {
    config.embeddings.buscaAtiva = true;
    usarPortaEmbeddings(portaEspia());
    const antes = await db().select().from(custosExternos).where(and(eq(custosExternos.fonte, "voyage")));
    await evidenciaParaTema(setorA, TEMA);
    const depois = await db().select().from(custosExternos).where(and(eq(custosExternos.fonte, "voyage")));
    expect(depois.length).toBe(antes.length + 1);
  });
});
