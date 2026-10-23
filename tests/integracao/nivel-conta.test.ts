/**
 * O nível conta do aprendizado e o isolamento entre marcas (E16, parte 1), contra o Postgres real e com o simulador de IA.
 *
 * O que rendeu mais ou menos que o normal na PRÓPRIA conta volta para o sistema do roteiro e da avaliação do tema (`desempenhoDaConta`), só com rótulo e número. A regra fixa do produto é "circula
 * padrão, nunca conteúdo": o que uma marca aprendeu nunca chega ao prompt de outra, nem de uma segunda marca da mesma pessoa, nem de uma marca do mesmo setor, e o bloco de uma marca nunca leva o tema ou
 * o texto de um roteiro, nem o dela. Os números de cada marca são diferentes de propósito (3,0 e 5,0 vezes) para um vazamento aparecer no texto.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, membrosMarca, metricasVideoCliente, nichos, roteiros, user, videosCliente, type Cliente, type Objetivo } from "@/db/schema";
import * as verificador from "@/ia/verificador";
import { desempenhoDaConta } from "@/servicos/desempenho-da-conta";
import { gerarRoteiro } from "@/servicos/roteiro";
import { avaliarTema } from "@/servicos/temas";

import { resetarSchema } from "../../scripts/resetar-schema";

/** Passa para o verificador de verdade, mas deixa ver o que cada tarefa recebeu. */
vi.mock("@/ia/verificador", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/verificador")>();
  return { ...original, gerarComVerificacao: vi.fn(original.gerarComVerificacao) };
});

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;
/** O "normal" de todas as contas deste teste: a mediana dos vídeos fica em 1000 views. */
const NORMAL = 1000;
const TITULO_BLOCO = "O que funcionou nos vídeos que este cliente já postou";

let nichoId: number;
let outroNichoId: number;
let marcaA: number;
let marcaA2: number; // outra marca da MESMA pessoa que a marca A
let marcaB: number;
let marcaC: number; // outro setor
let contador = 0;

async function criarMarca(usuarioId: string, nome: string, setor: number): Promise<number> {
  const [existente] = await db().select({ id: user.id }).from(user).where(eq(user.id, usuarioId));
  if (!existente) await db().insert(user).values({ id: usuarioId, name: nome, email: `${usuarioId}@nivel-conta.teste` });
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

type Postado = {
  objetivo: Objetivo;
  /** Quantas vezes o normal (NORMAL views) a última medição mostra. */
  vezes: number;
  /** Dias atrás que foi postado. */
  diasAtras?: number;
  /** Horas depois da postagem em que a última medição foi feita. */
  medidoApos?: number;
  /** O texto que o roteiro tem: o teste confere que ele nunca chega a nenhum bloco. */
  tema?: string;
  /** O dono do roteiro, quando for diferente do dono do vídeo (dado torto). */
  roteiroDe?: number;
};

/** Um vídeo postado e medido, com o roteiro que o gerou. */
async function postarMedido(clienteId: number, v: Postado): Promise<void> {
  contador += 1;
  const postadoEm = new Date(Date.now() - (v.diasAtras ?? 10) * DIA_MS);
  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId: v.roteiroDe ?? clienteId,
      data: postadoEm.toISOString().slice(0, 10),
      tema: v.tema ?? `tema comum ${contador}`,
      origem: "livre",
      objetivo: v.objetivo,
      tipoAbertura: "cena",
      status: "postado",
      postadoEm,
      conteudo: {
        titulo: "titulo",
        gancho: `gancho secreto ${contador}`,
        corpo: `corpo secreto ${contador}`,
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
    .values({ clienteId, roteiroId: roteiro.id, plataforma: "youtube", url: `https://youtu.be/nivelconta${contador}`, idExterno: `nivelconta${contador}`, postadoEm })
    .returning();
  await db()
    .insert(metricasVideoCliente)
    .values({ videoClienteId: video.id, coletadoEm: new Date(postadoEm.getTime() + (v.medidoApos ?? 80) * HORA_MS), views: Math.round(v.vezes * NORMAL), fonte: "youtube" });
}

/** 12 vídeos medidos, a mediana em NORMAL: 4 do objetivo em destaque (a `vezes`) e 8 do outro a 1x. */
async function contaComDestaque(clienteId: number, destaque: Objetivo, vezes: number, tema?: string): Promise<void> {
  const outro: Objetivo = destaque === "alcance" ? "engajamento" : "alcance";
  for (let i = 0; i < 4; i++) await postarMedido(clienteId, { objetivo: destaque, vezes, tema });
  for (let i = 0; i < 8; i++) await postarMedido(clienteId, { objetivo: outro, vezes: 1 });
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

/** A última chamada da tarefa: o sistema estável e a entrada que ela recebeu. */
function ultimaChamada(tarefa: "roteiro" | "avaliarTema") {
  const chamadas = vi.mocked(verificador.gerarComVerificacao).mock.calls.filter(([params]) => params.tarefa === tarefa);
  expect(chamadas.length).toBeGreaterThan(0);
  const [params] = chamadas[chamadas.length - 1];
  return { sistema: String(params.sistemaEstavel ?? ""), entrada: String(params.entrada) };
}

beforeAll(async () => {
  await resetarSchema(db());
  const [setor] = await db().insert(nichos).values({ slug: "nivel-conta-setor", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  const [outro] = await db().insert(nichos).values({ slug: "nivel-conta-outro", nome: "Outro setor", termos: ["outro"] }).returning();
  nichoId = setor.id;
  outroNichoId = outro.id;
  marcaA = await criarMarca("nivel-conta-pessoa-a", "[teste] Marca A", nichoId);
  marcaA2 = await criarMarca("nivel-conta-pessoa-a", "[teste] Marca A2", nichoId);
  marcaB = await criarMarca("nivel-conta-pessoa-b", "[teste] Marca B", nichoId);
  marcaC = await criarMarca("nivel-conta-pessoa-c", "[teste] Marca C", outroNichoId);
}, 60_000);

beforeEach(async () => {
  await limparPostados();
  vi.mocked(verificador.gerarComVerificacao).mockClear();
});

afterAll(async () => {
  await getPool().end();
});

describe("o que funcionou para a própria marca", () => {
  it("com 12 vídeos medidos e um objetivo que rende 3x, o bloco diz isso, com rótulo e número", async () => {
    await contaComDestaque(marcaA, "conversao", 3);
    const bloco = await desempenhoDaConta(marcaA);
    expect(bloco).toBe("- Vídeos feitos para te chamarem para comprar (4 vídeos): renderam 3,0 vezes o normal da conta.");
  });

  it("sem vídeo postado, ou com poucos, o bloco é vazio (o prompt é o de antes)", async () => {
    expect(await desempenhoDaConta(marcaA)).toBe("");
    for (let i = 0; i < 5; i++) await postarMedido(marcaA, { objetivo: "conversao", vezes: 3 });
    expect(await desempenhoDaConta(marcaA)).toBe("");
  });

  it("vídeo ainda subindo (última medição antes de 72 horas) não entra na conta", async () => {
    for (let i = 0; i < 4; i++) await postarMedido(marcaA, { objetivo: "conversao", vezes: 3, medidoApos: 30 });
    for (let i = 0; i < 8; i++) await postarMedido(marcaA, { objetivo: "alcance", vezes: 1 });
    // Os 4 que ainda subiam ficam de fora: sobram 8 iguais, sem grupo para comparar.
    expect(await desempenhoDaConta(marcaA)).toBe("");
  });

  it("vídeo postado há mais de 90 dias não entra", async () => {
    for (let i = 0; i < 4; i++) await postarMedido(marcaA, { objetivo: "conversao", vezes: 3, diasAtras: 120 });
    for (let i = 0; i < 8; i++) await postarMedido(marcaA, { objetivo: "alcance", vezes: 1 });
    expect(await desempenhoDaConta(marcaA)).toBe("");
  });

  it("o bloco nunca leva o tema nem o texto de um roteiro, nem o da própria marca", async () => {
    await contaComDestaque(marcaA, "conversao", 3, "tema secreto da marca A");
    const bloco = await desempenhoDaConta(marcaA);
    expect(bloco).not.toContain("secreto");
    expect(bloco).not.toContain("tema");
  });
});

describe("isolamento: o que uma marca aprendeu nunca chega a outra", () => {
  it("a outra marca do mesmo setor, sem vídeo nenhum, recebe vazio, mesmo com a marca A cheia de resultado", async () => {
    await contaComDestaque(marcaA, "conversao", 3);
    expect(await desempenhoDaConta(marcaA)).toContain("3,0 vezes");
    expect(await desempenhoDaConta(marcaB)).toBe("");
  });

  it("a segunda marca da MESMA pessoa também não herda: o aprendizado é da marca, não do dono", async () => {
    await contaComDestaque(marcaA, "conversao", 3);
    expect(await desempenhoDaConta(marcaA2)).toBe("");
  });

  it("uma marca de outro setor também recebe vazio", async () => {
    await contaComDestaque(marcaA, "conversao", 3);
    expect(await desempenhoDaConta(marcaC)).toBe("");
  });

  it("cada marca recebe só o seu: A com 3,0 vezes e B com 5,0 vezes, sem um número na casa do outro", async () => {
    await contaComDestaque(marcaA, "conversao", 3);
    await contaComDestaque(marcaB, "engajamento", 5);
    const blocoA = await desempenhoDaConta(marcaA);
    const blocoB = await desempenhoDaConta(marcaB);
    expect(blocoA).toContain("3,0 vezes");
    expect(blocoA).not.toContain("5,0");
    expect(blocoA).not.toContain("lembrarem");
    expect(blocoB).toContain("5,0 vezes");
    expect(blocoB).not.toContain("3,0");
    expect(blocoB).not.toContain("comprar");
  });

  it("dado torto: vídeo de uma marca ligado ao roteiro de outra não conta para nenhuma das duas", async () => {
    // 12 vídeos da marca B, todos apontando para roteiros da marca A (e o inverso na segunda rodada).
    for (let i = 0; i < 4; i++) await postarMedido(marcaB, { objetivo: "conversao", vezes: 3, roteiroDe: marcaA });
    for (let i = 0; i < 8; i++) await postarMedido(marcaB, { objetivo: "alcance", vezes: 1, roteiroDe: marcaA });
    expect(await desempenhoDaConta(marcaB)).toBe("");
    expect(await desempenhoDaConta(marcaA)).toBe("");
  });

  it("até o texto do roteiro: o sistema que a marca B recebe não tem nada da marca A, e o da A tem o bloco dela", async () => {
    await contaComDestaque(marcaA, "conversao", 3, "tema secreto da marca A");

    await gerarRoteiro(marcaA, { origem: "livre", textoTema: "como tirar mancha de café do sofá", objetivo: "alcance" });
    const deA = ultimaChamada("roteiro");
    expect(deA.sistema).toContain(TITULO_BLOCO);
    expect(deA.sistema).toContain("- Vídeos feitos para te chamarem para comprar (4 vídeos): renderam 3,0 vezes o normal da conta.");
    // O bloco de aprendizado não leva texto de roteiro (a lista de "roteiros recentes" da própria marca, na entrada, já existia e é dela).
    expect(deA.sistema).not.toContain("secreto");

    vi.mocked(verificador.gerarComVerificacao).mockClear();
    await gerarRoteiro(marcaB, { origem: "livre", textoTema: "como tirar mancha de café do sofá", objetivo: "alcance" });
    const deB = ultimaChamada("roteiro");
    expect(deB.sistema).not.toContain(TITULO_BLOCO);
    for (const pedaco of ["3,0 vezes", "comprar (4 vídeos)", "secreto", "normal da conta"]) {
      expect(deB.sistema).not.toContain(pedaco);
      expect(deB.entrada).not.toContain(pedaco);
    }

    vi.mocked(verificador.gerarComVerificacao).mockClear();
    await gerarRoteiro(marcaA2, { origem: "livre", textoTema: "como tirar mancha de café do sofá", objetivo: "alcance" });
    const deA2 = ultimaChamada("roteiro");
    expect(deA2.sistema).not.toContain(TITULO_BLOCO);
    expect(deA2.sistema).not.toContain("3,0 vezes");
  });

  it("e até o texto da avaliação do tema: A recebe o bloco dela, B e a segunda marca da pessoa A não", async () => {
    await contaComDestaque(marcaA, "conversao", 3, "tema secreto da marca A");

    await avaliarTema(await linhaDaMarca(marcaA), "como tirar mancha de café do sofá");
    const deA = ultimaChamada("avaliarTema");
    expect(deA.sistema).toContain(TITULO_BLOCO);
    expect(deA.sistema).toContain("renderam 3,0 vezes o normal da conta");
    expect(deA.sistema).not.toContain("secreto");

    for (const outra of [marcaB, marcaA2, marcaC]) {
      vi.mocked(verificador.gerarComVerificacao).mockClear();
      await avaliarTema(await linhaDaMarca(outra), "como tirar mancha de café do sofá");
      const deOutra = ultimaChamada("avaliarTema");
      expect(deOutra.sistema).not.toContain(TITULO_BLOCO);
      expect(deOutra.sistema).not.toContain("3,0 vezes");
      expect(deOutra.sistema).not.toContain("secreto");
    }
  });

  it("sem dado suficiente, o sistema do roteiro é exatamente o de antes: sem o bloco", async () => {
    await gerarRoteiro(marcaB, { origem: "livre", textoTema: "como tirar mancha de café do sofá", objetivo: "alcance" });
    expect(ultimaChamada("roteiro").sistema).not.toContain(TITULO_BLOCO);
  });
});
