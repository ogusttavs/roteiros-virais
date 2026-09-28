/**
 * `src/servicos/admin-acompanhamento.ts` (V10, painel de acompanhamento da
 * viagem): marcas ativas, o dia a dia por marca (coleta, transcrição,
 * temas, roteiros, curva, plano), e o topo "o que está quebrado agora"
 * (último erro de job, consumo por fonte, saúde agregada).
 * `ultimaGeracaoReprovadaDuasVezes` tem arquivo próprio, isolado, porque a
 * consulta olha a tabela `geracoes_ia` inteira sem filtro de nicho/cliente.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import {
  chamadasMetaApi,
  clientes,
  consumoApi,
  execucoesJob,
  metricasVideoCliente,
  nichos,
  planoGravacoes,
  roteiros,
  temasDia,
  user,
  videos,
  videosCliente,
} from "@/db/schema";
import { hojeISO } from "@/lib/config";
import {
  acompanhamentoDaViagem,
  consumoAgoraPorFonte,
  marcasAtivas,
  saudeDaViagem,
  ultimoErroDeJob,
} from "@/servicos/admin-acompanhamento";

import { resetarSchema } from "../../scripts/resetar-schema";

function diaIso(diasAtras: number): string {
  return hojeISO(new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000));
}

function meioDiaBrasil(dia: string): Date {
  return new Date(`${dia}T12:00:00-03:00`);
}

const HOJE = diaIso(0);
const ONTEM = diaIso(1);

let nichoId: number;
let marcaAtivaId: number;
let marcaInativaId: number;

beforeAll(async () => {
  await resetarSchema(db());

  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "admin-acompanhamento-teste", nome: "Admin acompanhamento teste", termos: [] })
    .returning();
  nichoId = nicho.id;

  await db().insert(user).values({ id: "admin-acomp-ativa", name: "[teste] ativa", email: "admin-acomp-ativa@teste.invalido" });
  const [marcaAtiva] = await db()
    .insert(clientes)
    .values({ usuarioId: "admin-acomp-ativa", nome: "[teste] Marca Ativa", nichoId, ativo: true, ultimoAcessoEm: meioDiaBrasil(HOJE) })
    .returning();
  marcaAtivaId = marcaAtiva.id;

  await db().insert(user).values({ id: "admin-acomp-inativa", name: "[teste] inativa", email: "admin-acomp-inativa@teste.invalido" });
  const [marcaInativa] = await db()
    .insert(clientes)
    .values({ usuarioId: "admin-acomp-inativa", nome: "[teste] Marca Inativa", nichoId, ativo: false })
    .returning();
  marcaInativaId = marcaInativa.id;

  // Coleta: um job ok e um job em erro no mesmo dia, no mesmo grupo ("coleta"); o pior estado (erro) deve vencer.
  await db().insert(execucoesJob).values([
    { nome: "coleta-youtube", status: "ok", iniciadoEm: meioDiaBrasil(HOJE), terminadoEm: meioDiaBrasil(HOJE) },
    { nome: "coleta-apify", status: "erro", erro: "falha de exemplo na coleta", iniciadoEm: meioDiaBrasil(HOJE), terminadoEm: meioDiaBrasil(HOJE) },
    { nome: "transcrever", status: "ok", iniciadoEm: meioDiaBrasil(ONTEM), terminadoEm: meioDiaBrasil(ONTEM) },
  ]);

  await db()
    .insert(videos)
    .values([
      { plataforma: "youtube", idExterno: "acomp-1", url: "https://x/1", nichoId, coletadoEm: meioDiaBrasil(HOJE) },
      { plataforma: "youtube", idExterno: "acomp-2", url: "https://x/2", nichoId, coletadoEm: meioDiaBrasil(HOJE) },
      {
        plataforma: "youtube",
        idExterno: "acomp-3",
        url: "https://x/3",
        nichoId,
        coletadoEm: meioDiaBrasil(ONTEM),
        transcricao: "transcricao de exemplo",
        transcritoEm: meioDiaBrasil(ONTEM),
      },
    ]);

  await db()
    .insert(temasDia)
    .values({
      nichoId,
      data: HOJE,
      temas: [{ titulo: "tema de exemplo", descricao: "descricao", porQue: "porque", evidencias: [], puxaPara: "alcance" }],
    });

  const CONTEUDO_MINIMO = {
    gancho: "gancho",
    corpo: "corpo",
    fechamento: "fechamento",
    chamadaFinal: "chamada final",
    cartoes: null,
    porQueAssim: [],
    cenas: [],
    ondeGravar: "no local do negocio",
    edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
    evidencias: [],
    semEvidencia: false,
    forcaEvidencia: null,
  };

  await db()
    .insert(roteiros)
    .values([
      {
        clienteId: marcaAtivaId,
        data: HOJE,
        tema: "tema 1",
        origem: "sugerido",
        objetivo: "alcance",
        formato: "reels",
        conteudo: CONTEUDO_MINIMO as never,
        status: "gravado",
        gravadoEm: meioDiaBrasil(HOJE),
      },
      {
        clienteId: marcaAtivaId,
        data: HOJE,
        tema: "tema 2",
        origem: "momento",
        objetivo: "conversao",
        formato: "story",
        conteudo: CONTEUDO_MINIMO as never,
        status: "postado",
        gravadoEm: meioDiaBrasil(HOJE),
        postadoEm: meioDiaBrasil(HOJE),
        urlPostado: "https://exemplo.invalido/postado",
      },
      {
        clienteId: marcaAtivaId,
        data: HOJE,
        tema: "tema 3",
        origem: "livre",
        objetivo: "engajamento",
        formato: "reels",
        conteudo: CONTEUDO_MINIMO as never,
        status: "gerado",
      },
    ]);

  const [videoCliente] = await db()
    .insert(videosCliente)
    .values({ clienteId: marcaAtivaId, plataforma: "instagram", url: "https://exemplo.invalido/vc1", postadoEm: meioDiaBrasil(HOJE) })
    .returning();
  await db().insert(metricasVideoCliente).values({ videoClienteId: videoCliente.id, views: 100, coletadoEm: meioDiaBrasil(HOJE), fonte: "meta" });

  await db()
    .insert(planoGravacoes)
    .values([
      {
        clienteId: marcaAtivaId,
        dia: HOJE,
        ordem: 1,
        lugar: "cozinha",
        situacao: "fazendo o produto",
        oQueMostrar: "o passo a passo do produto sendo feito",
        objetivo: "alcance" as const,
        estado: "sugerido" as const,
      },
      {
        clienteId: marcaAtivaId,
        dia: HOJE,
        ordem: 2,
        lugar: "sala",
        situacao: "mostrando o resultado",
        oQueMostrar: "o antes e depois",
        objetivo: "conversao" as const,
        estado: "sugerido" as const,
      },
      {
        clienteId: marcaAtivaId,
        dia: HOJE,
        ordem: 3,
        lugar: "quintal",
        situacao: "depoimento",
        oQueMostrar: "o cliente falando",
        objetivo: "engajamento" as const,
        estado: "aceito" as const,
      },
    ]);

  await db()
    .insert(consumoApi)
    .values([
      { fonte: "youtube", data: HOJE, unidades: 500 },
      { fonte: "apify", data: HOJE, unidades: 200 },
    ]);
  await db()
    .insert(chamadasMetaApi)
    .values([{}, {}, {}]);
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("marcasAtivas", () => {
  it("lista so quem esta ativo, nunca a marca desativada", async () => {
    const marcas = await marcasAtivas();
    const ids = marcas.map((m) => m.id);
    expect(ids).toContain(marcaAtivaId);
    expect(ids).not.toContain(marcaInativaId);
  });
});

describe("acompanhamentoDaViagem", () => {
  it("junta coleta, transcricao, temas, roteiros, curva e plano por marca e por dia", async () => {
    const [marca] = await acompanhamentoDaViagem(7, marcaAtivaId);
    expect(marca.nome).toBe("[teste] Marca Ativa");
    expect(marca.ultimoAcessoEm).not.toBeNull();

    const linhaHoje = marca.linhas.find((l) => l.dia === HOJE);
    expect(linhaHoje).toBeDefined();
    // Um job "ok" e um "erro" no mesmo dia, mesmo grupo: o pior estado vence.
    expect(linhaHoje?.coleta.estado).toBe("erro");
    expect(linhaHoje?.coleta.erro).toBe("falha de exemplo na coleta");
    expect(linhaHoje?.coleta.novos).toBe(2);
    expect(linhaHoje?.temas).toBe(1);
    expect(linhaHoje?.roteiros).toEqual({
      porOrigem: { sugerido: 1, livre: 1, momento: 1 },
      porFormato: { reels: 2, story: 1 },
      gravados: 2,
      postados: 1,
      total: 3,
    });
    expect(linhaHoje?.curva.medidas).toBe(1);
    expect(linhaHoje?.plano).toEqual({ sugerido: 2, aceito: 1, gravado: 0, pulado: 0 });

    const linhaOntem = marca.linhas.find((l) => l.dia === ONTEM);
    expect(linhaOntem?.transcrever.estado).toBe("ok");
    expect(linhaOntem?.transcrever.transcritos).toBe(1);
    expect(linhaOntem?.coleta.novos).toBe(1);
  });

  it("um dia sem nenhuma execucao vem 'sem_execucao', nunca 'ok' inventado", async () => {
    const [marca] = await acompanhamentoDaViagem(7, marcaAtivaId);
    const linhaAntiga = marca.linhas[0];
    expect(linhaAntiga.coleta.estado).toBe("sem_execucao");
    expect(linhaAntiga.roteiros.total).toBe(0);
  });

  it("sem marcaId, devolve todas as marcas ativas (nunca a inativa)", async () => {
    const marcas = await acompanhamentoDaViagem(7);
    expect(marcas.some((m) => m.id === marcaAtivaId)).toBe(true);
    expect(marcas.some((m) => m.id === marcaInativaId)).toBe(false);
  });
});

describe("ultimoErroDeJob", () => {
  it("acha o job mais recente com status erro, com a mensagem", async () => {
    const erro = await ultimoErroDeJob();
    expect(erro?.nome).toBe("coleta-apify");
    expect(erro?.mensagem).toBe("falha de exemplo na coleta");
  });
});

describe("consumoAgoraPorFonte", () => {
  it("le consumo_api para youtube e apify, e chamadas_meta_api para meta na ultima hora", async () => {
    const consumo = await consumoAgoraPorFonte();
    const porFonte = Object.fromEntries(consumo.map((c) => [c.fonte, c]));

    expect(porFonte.youtube).toMatchObject({ unidades: 500, unidade: "dia" });
    expect(porFonte.youtube.teto).toBeGreaterThan(0);
    expect(porFonte.apify).toMatchObject({ unidades: 200, unidade: "dia" });
    expect(porFonte.meta).toMatchObject({ unidades: 3, unidade: "hora" });
    expect(porFonte.groq).toMatchObject({ unidades: 0, teto: null });
  });
});

describe("saudeDaViagem", () => {
  it("devolve so contagens e horarios, nenhum dado de cliente", async () => {
    const saude = await saudeDaViagem();
    expect(saude.ok).toBe(true);
    expect(saude.marcasAtivas).toBeGreaterThanOrEqual(1);
    expect(saude.roteirosHoje).toBeGreaterThanOrEqual(3);
    expect(saude.ultimaColetaOkEm).not.toBeNull();
    expect(saude.ultimoErroJob).toEqual({ nome: "coleta-apify", quando: expect.any(String) });
    expect(JSON.stringify(saude)).not.toContain("Marca Ativa");
    expect(JSON.stringify(saude)).not.toContain("tema 1");
  });
});
