/**
 * A ordem dos temas do dia por marca (E16 PR 4), contra o Postgres real.
 *
 * Os temas do dia são do SETOR (`temas_dia`, uma linha por setor e dia) e todas as marcas leem a mesma lista em `temasParaCliente`. O que muda de marca para marca é só a ordem: quando a própria marca
 * tem dado suficiente e um objetivo rendeu claramente mais na conta dela, os temas que puxam para ele sobem. Sem dado, a ordem é a do setor. "Circula padrão, nunca conteúdo": nada da marca A pode mudar
 * a ordem da marca B, e o texto de cada tema continua sendo o do setor.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, membrosMarca, metricasVideoCliente, nichos, roteiros, temasDia, user, videosCliente, type Cliente, type Objetivo } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { temasParaCliente } from "@/servicos/temas";

import { resetarSchema } from "../../scripts/resetar-schema";

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;
/** O "normal" de todas as contas deste teste: a mediana dos vídeos fica em 1000 views. */
const NORMAL = 1000;
const OBJETIVOS: Objetivo[] = ["alcance", "engajamento", "conversao"];
/** A ordem do setor: a que toda marca sem dado enxerga. */
const ORDEM_DO_SETOR = ["tema de alcance", "tema de engajamento", "tema de conversao"];

let nichoId: number;
let outroNichoId: number;
let marcaA: number;
let marcaA2: number; // outra marca da MESMA pessoa que a marca A
let marcaB: number;
let marcaC: number;
let marcaD: number; // outro setor
let contador = 0;

async function criarMarca(usuarioId: string, nome: string, setor: number): Promise<number> {
  const [existente] = await db().select({ id: user.id }).from(user).where(eq(user.id, usuarioId));
  if (!existente) await db().insert(user).values({ id: usuarioId, name: nome, email: `${usuarioId}@ordem-temas.teste` });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome, nichoId: setor }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  await db().insert(briefings).values({
    clienteId: marca.id,
    completo: true,
    perfil: {
      fatos: { oQueVende: "kit tira-mancha", preco: "kit a partir de 89 reais", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [] },
      resumo: "produtos de limpeza",
      referencias: [],
    } as never,
  });
  return marca.id;
}

async function criarTemasDoSetor(setor: number): Promise<void> {
  await db()
    .insert(temasDia)
    .values({
      nichoId: setor,
      data: hojeISO(),
      temas: OBJETIVOS.map((puxaPara) => ({ titulo: `tema de ${puxaPara}`, descricao: `descricao do tema de ${puxaPara}`, porQue: "por que", evidencias: [1], puxaPara })),
    });
}

type Postado = {
  objetivo: Objetivo;
  /** Quantas vezes o normal (NORMAL views) a última medição mostra. */
  vezes: number;
  diasAtras: number;
  /** Horas depois da postagem em que a última medição foi feita. */
  medidoApos?: number;
  /** O dono do roteiro, quando for diferente do dono do vídeo (dado torto). */
  roteiroDe?: number;
};

/** Um vídeo postado e medido (por padrão a 80 horas da postagem), com o roteiro que o gerou. */
async function postarMedido(clienteId: number, v: Postado): Promise<void> {
  contador += 1;
  const postadoEm = new Date(Date.now() - v.diasAtras * DIA_MS);
  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId: v.roteiroDe ?? clienteId,
      data: hojeISO(postadoEm),
      tema: `tema comum ${contador}`,
      origem: "livre",
      objetivo: v.objetivo,
      tipoAbertura: "cena",
      status: "postado",
      postadoEm,
      conteudo: {
        titulo: "titulo",
        gancho: "gancho",
        corpo: "corpo",
        fechamento: "fechamento",
        chamadaFinal: "chamada",
        duracaoS: 30,
        cartoes: null,
        ondeGravar: "onde",
        comoEditar: { textoNaTela: [], ritmoDeCorte: "", recursos: [], audio: "", referencia: "" },
      } as never,
    })
    .returning();
  const [video] = await db()
    .insert(videosCliente)
    .values({ clienteId, roteiroId: roteiro.id, plataforma: "youtube", url: `https://youtu.be/ordemtemas${contador}`, idExterno: `ordemtemas${contador}`, postadoEm })
    .returning();
  await db()
    .insert(metricasVideoCliente)
    .values({ videoClienteId: video.id, coletadoEm: new Date(postadoEm.getTime() + (v.medidoApos ?? 80) * HORA_MS), views: Math.round(v.vezes * NORMAL), fonte: "youtube" });
}

/**
 * `quantos` vídeos medidos, os objetivos intercalados (um de cada, em rodízio, para a linha editorial não achar nenhum zerado) e o objetivo em destaque a `vezes`, os outros a 1x. Com 12 vídeos
 * (4 por objetivo), a mediana da conta fica em NORMAL.
 */
async function contaComDestaque(clienteId: number, destaque: Objetivo, vezes: number, quantos = 12, extra: Partial<Postado> = {}): Promise<void> {
  for (let i = 0; i < quantos; i++) {
    const objetivo = OBJETIVOS[i % OBJETIVOS.length];
    await postarMedido(clienteId, { objetivo, vezes: objetivo === destaque ? vezes : 1, diasAtras: 5 + i, ...extra });
  }
}

async function limparPostados(): Promise<void> {
  await db().delete(metricasVideoCliente);
  await db().delete(videosCliente);
  await db().delete(roteiros);
}

async function linhaDaMarca(id: number): Promise<Cliente> {
  const [linha] = await db().select().from(clientes).where(eq(clientes.id, id));
  return linha;
}

async function ordemDaMarca(id: number): Promise<string[]> {
  const resultado = await temasParaCliente(await linhaDaMarca(id));
  expect(resultado.status).toBe("ok");
  if (resultado.status !== "ok") return [];
  return resultado.temas.map((t) => t.titulo);
}

beforeAll(async () => {
  await resetarSchema(db());
  const [setor] = await db().insert(nichos).values({ slug: "ordem-temas-setor", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  const [outro] = await db().insert(nichos).values({ slug: "ordem-temas-outro", nome: "Outro setor", termos: ["outro"] }).returning();
  nichoId = setor.id;
  outroNichoId = outro.id;
  marcaA = await criarMarca("ordem-temas-pessoa-a", "[teste] Marca A", nichoId);
  marcaA2 = await criarMarca("ordem-temas-pessoa-a", "[teste] Marca A2", nichoId);
  marcaB = await criarMarca("ordem-temas-pessoa-b", "[teste] Marca B", nichoId);
  marcaC = await criarMarca("ordem-temas-pessoa-c", "[teste] Marca C", nichoId);
  marcaD = await criarMarca("ordem-temas-pessoa-d", "[teste] Marca D", outroNichoId);
  await criarTemasDoSetor(nichoId);
  await criarTemasDoSetor(outroNichoId);
}, 60_000);

beforeEach(async () => {
  await limparPostados();
});

afterAll(async () => {
  await getPool().end();
});

describe("sem dado suficiente nada muda", () => {
  it("marca sem vídeo nenhum: a ordem é a do setor", async () => {
    expect(await ordemDaMarca(marcaC)).toEqual(ORDEM_DO_SETOR);
  });

  it("poucos vídeos medidos (7 de 8): a ordem é a do setor, mesmo com um objetivo muito acima", async () => {
    await contaComDestaque(marcaC, "conversao", 5, 7);
    expect(await ordemDaMarca(marcaC)).toEqual(ORDEM_DO_SETOR);
  });

  it("vídeo ainda subindo (medido antes de 72 horas) não conta: a ordem é a do setor", async () => {
    await contaComDestaque(marcaC, "conversao", 5, 12, { medidoApos: 30 });
    expect(await ordemDaMarca(marcaC)).toEqual(ORDEM_DO_SETOR);
  });

  it("nenhum objetivo se destaca (todos no normal da conta): a ordem é a do setor", async () => {
    await contaComDestaque(marcaC, "conversao", 1);
    expect(await ordemDaMarca(marcaC)).toEqual(ORDEM_DO_SETOR);
  });
});

describe("com dado suficiente, o objetivo que rende sobe", () => {
  it("conversão rende 3x na conta: o tema de conversão vai para o primeiro lugar e o resto segue a ordem do setor", async () => {
    await contaComDestaque(marcaA, "conversao", 3);
    expect(await ordemDaMarca(marcaA)).toEqual(["tema de conversao", "tema de alcance", "tema de engajamento"]);
  });

  it("só a ordem muda: o texto e a lista de temas continuam os do setor", async () => {
    await contaComDestaque(marcaA, "engajamento", 3);
    const doSetor = await temasParaCliente(await linhaDaMarca(marcaC));
    const daMarca = await temasParaCliente(await linhaDaMarca(marcaA));
    if (doSetor.status !== "ok" || daMarca.status !== "ok") throw new Error("era para haver tema");
    expect(daMarca.temas.map((t) => t.titulo)).not.toEqual(doSetor.temas.map((t) => t.titulo));
    const porTitulo = (lista: typeof doSetor.temas) => [...lista].sort((a, b) => a.titulo.localeCompare(b.titulo));
    expect(porTitulo(daMarca.temas)).toEqual(porTitulo(doSetor.temas));
    expect(daMarca.dataUsada).toBe(doSetor.dataUsada);
  });

  it("o tema sobe pelo objetivo que rende, não pelo que a marca mais fez", async () => {
    // 8 vídeos de alcance a 1x e 4 de engajamento a 3x: alcance é o que ela mais fez, engajamento é o que rende.
    for (let i = 0; i < 4; i++) await postarMedido(marcaA, { objetivo: "engajamento", vezes: 3, diasAtras: 5 + i * 2 });
    for (let i = 0; i < 8; i++) await postarMedido(marcaA, { objetivo: "alcance", vezes: 1, diasAtras: 6 + i * 2 });
    const resultado = await temasParaCliente(await linhaDaMarca(marcaA));
    if (resultado.status !== "ok") throw new Error("era para haver tema");
    // A linha editorial pode pedir outro objetivo no primeiro lugar (a marca nunca fez conversão), mas o de engajamento vem antes do de alcance.
    const ordem = resultado.temas.map((t) => t.titulo);
    expect(ordem.indexOf("tema de engajamento")).toBeLessThan(ordem.indexOf("tema de alcance"));
  });
});

describe("isolamento: nada de uma marca muda a ordem de outra", () => {
  it("duas marcas do mesmo setor, no mesmo dia, com ordens diferentes, e a terceira, sem dado, na do setor", async () => {
    await contaComDestaque(marcaA, "conversao", 3);
    await contaComDestaque(marcaB, "engajamento", 3);
    expect(await ordemDaMarca(marcaA)).toEqual(["tema de conversao", "tema de alcance", "tema de engajamento"]);
    expect(await ordemDaMarca(marcaB)).toEqual(["tema de engajamento", "tema de alcance", "tema de conversao"]);
    expect(await ordemDaMarca(marcaC)).toEqual(ORDEM_DO_SETOR);
    // Lendo de novo, em outra ordem, nada fica preso de uma leitura anterior.
    expect(await ordemDaMarca(marcaB)).toEqual(["tema de engajamento", "tema de alcance", "tema de conversao"]);
    expect(await ordemDaMarca(marcaA)).toEqual(["tema de conversao", "tema de alcance", "tema de engajamento"]);
  });

  it("a linha do setor em temas_dia continua como o job gravou (a ordem por marca é só na leitura)", async () => {
    await contaComDestaque(marcaA, "conversao", 3);
    await ordemDaMarca(marcaA);
    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linha.temas.map((t) => t.titulo)).toEqual(ORDEM_DO_SETOR);
  });

  it("a outra marca da MESMA pessoa não herda: a ordem é da marca, não do dono", async () => {
    await contaComDestaque(marcaA, "conversao", 3);
    expect(await ordemDaMarca(marcaA2)).toEqual(ORDEM_DO_SETOR);
  });

  it("uma marca de outro setor, com dado próprio, só mexe na lista do setor dela", async () => {
    await contaComDestaque(marcaD, "engajamento", 3);
    expect(await ordemDaMarca(marcaD)).toEqual(["tema de engajamento", "tema de alcance", "tema de conversao"]);
    expect(await ordemDaMarca(marcaC)).toEqual(ORDEM_DO_SETOR);
  });

  it("vídeo da marca B ligado a roteiros da marca A não conta para nenhuma das duas", async () => {
    await contaComDestaque(marcaB, "conversao", 3, 12, { roteiroDe: marcaA });
    expect(await ordemDaMarca(marcaB)).toEqual(ORDEM_DO_SETOR);
    expect(await ordemDaMarca(marcaA)).toEqual(ORDEM_DO_SETOR);
  });
});

describe("a linha editorial continua mandando no primeiro lugar", () => {
  it("quando falta variedade, o tema do objetivo em falta fica em primeiro e o resto segue a ordem da conta", async () => {
    // Conversão rende 3x, mas a marca nunca gravou engajamento: a linha editorial pede engajamento em primeiro.
    for (let i = 0; i < 4; i++) await postarMedido(marcaA, { objetivo: "conversao", vezes: 3, diasAtras: 5 + i * 2 });
    for (let i = 0; i < 8; i++) await postarMedido(marcaA, { objetivo: "alcance", vezes: 1, diasAtras: 6 + i * 2 });
    const resultado = await temasParaCliente(await linhaDaMarca(marcaA));
    if (resultado.status !== "ok") throw new Error("era para haver tema");
    expect(resultado.avisoLinhaEditorial).not.toBeNull();
    expect(resultado.temas.map((t) => t.titulo)).toEqual(["tema de engajamento", "tema de conversao", "tema de alcance"]);
  });
});
