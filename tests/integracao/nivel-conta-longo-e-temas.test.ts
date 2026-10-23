/**
 * O nível conta do aprendizado no roteiro LONGO (E16, PR 3), e a prova de que os temas do dia NÃO recebem o bloco, contra o Postgres real e com o simulador de IA.
 *
 * O roteiro longo recebe o mesmo bloco do curto ("O que funcionou nos vídeos que este cliente já postou"), só da PRÓPRIA marca, só com rótulo e número, e sem a linha de duração (a duração do longo vem
 * da medida dos longos do ramo). Os temas do dia são gerados por RAMO, uma vez para todas as marcas do setor, sem saber qual marca vai ler: o bloco de uma marca nunca pode entrar neles, e o teste do fim
 * prova que, com uma marca cheia de resultado no setor, o que o modelo dos temas recebe não leva nada dela. Os números de cada marca são diferentes de propósito (3,0 e 5,0 vezes) para um vazamento aparecer.
 */
import { eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import {
  briefings,
  clientes,
  contas,
  geracoesIA,
  membrosMarca,
  metricasVideoCliente,
  nichos,
  roteiros,
  temasDia,
  user,
  videos,
  videosCliente,
  type Objetivo,
} from "@/db/schema";
import * as clienteIA from "@/ia/cliente";
import * as verificador from "@/ia/verificador";
import { rodarTemasDoDia } from "@/jobs/temas-do-dia";
import { hojeISO } from "@/lib/config";
import { desempenhoDaConta } from "@/servicos/desempenho-da-conta";
import { gerarRoteiro } from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

/** Passam para o de verdade, mas deixam ver o que cada tarefa recebeu. */
vi.mock("@/ia/verificador", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/verificador")>();
  return { ...original, gerarComVerificacao: vi.fn(original.gerarComVerificacao) };
});
vi.mock("@/ia/cliente", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;
/** O "normal" de todas as contas deste teste: a mediana dos vídeos fica em 1000 views. */
const NORMAL = 1000;
const TITULO_BLOCO = "O que funcionou nos vídeos que este cliente já postou";
const TEMA = "como tirar mancha de café do sofá";

let nichoId: number;
let outroNichoId: number;
let marcaA: number;
let marcaA2: number; // outra marca da MESMA pessoa que a marca A
let marcaB: number;
let marcaC: number; // outro setor
let contaDoSetorId: number;
let contaDoSetorBId: number;
let contador = 0;

async function criarMarca(usuarioId: string, nome: string, setor: number): Promise<number> {
  const [existente] = await db().select({ id: user.id }).from(user).where(eq(user.id, usuarioId));
  if (!existente) await db().insert(user).values({ id: usuarioId, name: nome, email: `${usuarioId}@nivel-conta-longo.teste` });
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

/** Quatro vídeos longos medidos no setor (8, 9, 10 e 11 minutos): a medida que o roteiro longo exige. */
async function semearLongos(setor: number, conta: number, prefixo: string): Promise<void> {
  for (const duracaoS of [480, 540, 600, 660]) {
    await db().insert(videos).values({
      plataforma: "youtube",
      idExterno: `${prefixo}-${duracaoS}`,
      url: `https://exemplo.invalido/${prefixo}-${duracaoS}`,
      nichoId: setor,
      contaId: conta,
      titulo: `[exemplo] longo ${prefixo} ${duracaoS}`,
      views: 100_000,
      foraDaCurva: "3.000",
      duracaoS,
      publicadoEm: new Date(Date.now() - 5 * DIA_MS),
      idioma: "pt",
      origem: "coleta",
    });
  }
}

type Postado = {
  objetivo: Objetivo;
  /** Quantas vezes o normal (NORMAL views) a última medição mostra. */
  vezes: number;
  /** A duração do vídeo curto, em segundos (o `conteudo.duracaoS` do roteiro). */
  duracaoS?: number;
  /** O texto que o roteiro tem: o teste confere que ele nunca chega a nenhum bloco. */
  tema?: string;
};

/** Um vídeo postado e medido (Reels curto), com o roteiro que o gerou. */
async function postarMedido(clienteId: number, v: Postado): Promise<void> {
  contador += 1;
  const postadoEm = new Date(Date.now() - 10 * DIA_MS);
  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId,
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
        duracaoS: v.duracaoS ?? 30,
        cartoes: null,
        ondeGravar: "onde",
        comoEditar: { textoNaTela: [], ritmoDeCorte: "", recursos: [], audio: "", referencia: "" },
      } as never,
    })
    .returning();
  const [video] = await db()
    .insert(videosCliente)
    .values({ clienteId, roteiroId: roteiro.id, plataforma: "youtube", url: `https://youtu.be/nclongo${contador}`, idExterno: `nclongo${contador}`, postadoEm })
    .returning();
  await db()
    .insert(metricasVideoCliente)
    .values({ videoClienteId: video.id, coletadoEm: new Date(postadoEm.getTime() + 80 * HORA_MS), views: Math.round(v.vezes * NORMAL), fonte: "youtube" });
}

/** 12 vídeos medidos, a mediana em NORMAL: 4 do objetivo em destaque (a `vezes`) e 8 do outro a 1x. */
async function contaComDestaque(clienteId: number, destaque: Objetivo, vezes: number, tema?: string): Promise<void> {
  const outro: Objetivo = destaque === "alcance" ? "engajamento" : "alcance";
  for (let i = 0; i < 4; i++) await postarMedido(clienteId, { objetivo: destaque, vezes, tema });
  for (let i = 0; i < 8; i++) await postarMedido(clienteId, { objetivo: outro, vezes: 1 });
}

/** 12 vídeos do MESMO objetivo, em que só a duração separa o que rendeu: 4 de 15 segundos a 3x e 8 de 30 segundos a 1x. */
async function contaComDuracaoEmDestaque(clienteId: number): Promise<void> {
  for (let i = 0; i < 4; i++) await postarMedido(clienteId, { objetivo: "alcance", vezes: 3, duracaoS: 15 });
  for (let i = 0; i < 8; i++) await postarMedido(clienteId, { objetivo: "alcance", vezes: 1, duracaoS: 30 });
}

async function limparPostados(): Promise<void> {
  await db().delete(metricasVideoCliente);
  await db().delete(videosCliente);
  await db().delete(roteiros);
}

/** A última chamada do roteiro longo ou curto: o sistema estável e a entrada que ela recebeu. */
function ultimaChamada(tarefa: "roteiroLongo" | "roteiro") {
  const chamadas = vi.mocked(verificador.gerarComVerificacao).mock.calls.filter(([params]) => params.tarefa === tarefa);
  expect(chamadas.length).toBeGreaterThan(0);
  const [params] = chamadas[chamadas.length - 1];
  return { sistema: String(params.sistemaEstavel ?? ""), entrada: String(params.entrada) };
}

async function longoDe(clienteId: number) {
  vi.mocked(verificador.gerarComVerificacao).mockClear();
  await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });
  return ultimaChamada("roteiroLongo");
}

beforeAll(async () => {
  await resetarSchema(db());
  const [setor] = await db().insert(nichos).values({ slug: "nc-longo-setor", nome: "Produtos de limpeza", termos: ["limpeza"], criadoEm: new Date(Date.now() - 30 * DIA_MS) }).returning();
  const [outro] = await db().insert(nichos).values({ slug: "nc-longo-outro", nome: "Outro setor", termos: ["outro"] }).returning();
  nichoId = setor.id;
  outroNichoId = outro.id;
  const [contaA, contaB, contaOutro] = await db()
    .insert(contas)
    .values([
      { plataforma: "youtube", handle: "nc-longo-a", nichoId, pais: "BR", idiomaPrincipal: "pt" },
      { plataforma: "youtube", handle: "nc-longo-b", nichoId, pais: "BR", idiomaPrincipal: "pt" },
      { plataforma: "youtube", handle: "nc-longo-c", nichoId: outroNichoId, pais: "BR", idiomaPrincipal: "pt" },
    ])
    .returning();
  contaDoSetorId = contaA.id;
  contaDoSetorBId = contaB.id;
  await semearLongos(nichoId, contaA.id, "nc-longo");
  await semearLongos(outroNichoId, contaOutro.id, "nc-longo-outro");
  marcaA = await criarMarca("nc-longo-pessoa-a", "[teste] Marca A", nichoId);
  marcaA2 = await criarMarca("nc-longo-pessoa-a", "[teste] Marca A2", nichoId);
  marcaB = await criarMarca("nc-longo-pessoa-b", "[teste] Marca B", nichoId);
  marcaC = await criarMarca("nc-longo-pessoa-c", "[teste] Marca C", outroNichoId);
}, 60_000);

beforeEach(async () => {
  await limparPostados();
  vi.mocked(verificador.gerarComVerificacao).mockClear();
  vi.mocked(clienteIA.gerarEstruturado).mockClear();
});

afterAll(async () => {
  await getPool().end();
});

describe("o roteiro longo recebe o que funcionou na própria conta", () => {
  it("com 12 vídeos medidos, o sistema do longo leva o bloco da marca, só com rótulo e número, e sem texto de roteiro", async () => {
    await contaComDestaque(marcaA, "conversao", 3, "tema secreto da marca A");
    const { sistema } = await longoDe(marcaA);
    expect(sistema).toContain(TITULO_BLOCO);
    expect(sistema).toContain("- Vídeos feitos para te chamarem para comprar (4 vídeos): renderam 3,0 vezes o normal da conta.");
    expect(sistema).toContain("A duração e a estrutura deste vídeo vêm da entrada");
    expect(sistema).not.toContain("secreto");
  });

  it("sem dado suficiente (nenhum vídeo, ou poucos), o sistema do longo não tem o bloco: é o de antes", async () => {
    expect((await longoDe(marcaB)).sistema).not.toContain(TITULO_BLOCO);
    for (let i = 0; i < 5; i++) await postarMedido(marcaB, { objetivo: "conversao", vezes: 3 });
    expect((await longoDe(marcaB)).sistema).not.toContain(TITULO_BLOCO);
  });

  it("o longo não leva a linha de duração (a dele vem da medida dos longos do ramo), mas o curto da mesma marca leva", async () => {
    await contaComDuracaoEmDestaque(marcaA);

    // o bloco que o curto lê tem a faixa de duração...
    expect(await desempenhoDaConta(marcaA)).toContain("de até 20 segundos");
    // ...e o que o longo lê, não: nem a faixa, nem nenhuma outra linha (a duração era a única diferença entre os vídeos)
    expect(await desempenhoDaConta(marcaA, new Date(), { semDimensoes: ["duracao"] })).toBe("");

    const { sistema } = await longoDe(marcaA);
    expect(sistema).not.toContain(TITULO_BLOCO);
    expect(sistema).not.toContain("de até 20 segundos");

    vi.mocked(verificador.gerarComVerificacao).mockClear();
    await gerarRoteiro(marcaA, { origem: "livre", textoTema: TEMA, objetivo: "alcance" });
    const curto = ultimaChamada("roteiro");
    expect(curto.sistema).toContain(TITULO_BLOCO);
    expect(curto.sistema).toContain("de até 20 segundos");
  });

  it("o schema de saída do longo é o mesmo: a geração guarda a versão nova do prompt e o roteiro sai inteiro", async () => {
    await contaComDestaque(marcaA, "conversao", 3);
    const roteiro = await gerarRoteiro(marcaA, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });
    expect(roteiro.duracaoDoVideo).toBe("longo");
    expect(roteiro.conteudo.capitulos?.length).toBeGreaterThanOrEqual(3);
    const [geracao] = await db().select().from(geracoesIA).where(eq(geracoesIA.id, roteiro.geracaoId!));
    expect(geracao.versaoPrompt).toBe("1.4.0");
  });
});

describe("isolamento no roteiro longo: o que uma marca aprendeu nunca chega a outra", () => {
  it("até o texto que a IA recebe: B, a segunda marca da pessoa A e uma marca de outro setor não recebem nada da marca A", async () => {
    await contaComDestaque(marcaA, "conversao", 3, "tema secreto da marca A");

    const deA = await longoDe(marcaA);
    expect(deA.sistema).toContain("renderam 3,0 vezes o normal da conta");

    for (const outra of [marcaB, marcaA2, marcaC]) {
      const deOutra = await longoDe(outra);
      expect(deOutra.sistema).not.toContain(TITULO_BLOCO);
      for (const pedaco of ["3,0 vezes", "comprar (4 vídeos)", "secreto", "normal da conta"]) {
        expect(deOutra.sistema).not.toContain(pedaco);
        expect(deOutra.entrada).not.toContain(pedaco);
      }
    }
  });

  it("cada marca recebe só o seu: A com 3,0 vezes e B com 5,0 vezes, sem um número na casa do outro", async () => {
    await contaComDestaque(marcaA, "conversao", 3);
    await contaComDestaque(marcaB, "engajamento", 5);

    const deA = (await longoDe(marcaA)).sistema;
    const deB = (await longoDe(marcaB)).sistema;
    expect(deA).toContain("3,0 vezes");
    expect(deA).not.toContain("5,0");
    expect(deA).not.toContain("feitos para lembrarem de você");
    expect(deB).toContain("5,0 vezes");
    expect(deB).not.toContain("3,0");
    expect(deB).not.toContain("feitos para te chamarem para comprar");
  });

  it("dado torto: vídeo da marca B ligado a roteiros da marca A não vira bloco para nenhuma das duas", async () => {
    contador += 1;
    const [roteiroDeA] = await db()
      .insert(roteiros)
      .values({ clienteId: marcaA, data: hojeISO(), tema: "tema da A", origem: "livre", objetivo: "conversao", tipoAbertura: "cena", status: "postado", postadoEm: new Date(Date.now() - 10 * DIA_MS), conteudo: { gancho: "g", corpo: "c", fechamento: "f", chamadaFinal: "x", duracaoS: 30 } as never })
      .returning();
    for (let i = 0; i < 12; i++) {
      contador += 1;
      const postadoEm = new Date(Date.now() - 10 * DIA_MS);
      const [video] = await db()
        .insert(videosCliente)
        .values({ clienteId: marcaB, roteiroId: roteiroDeA.id, plataforma: "youtube", url: `https://youtu.be/torto${contador}`, idExterno: `torto${contador}`, postadoEm })
        .returning();
      await db().insert(metricasVideoCliente).values({ videoClienteId: video.id, coletadoEm: new Date(postadoEm.getTime() + 80 * HORA_MS), views: i < 4 ? 3000 : 1000, fonte: "youtube" });
    }
    expect((await longoDe(marcaB)).sistema).not.toContain(TITULO_BLOCO);
    expect((await longoDe(marcaA)).sistema).not.toContain(TITULO_BLOCO);
  });
});

describe("os temas do dia são do RAMO e não recebem o bloco de nenhuma marca", () => {
  async function semearCurtosComProva(): Promise<void> {
    const alternadas = [contaDoSetorId, contaDoSetorBId];
    for (let i = 0; i < 3; i++) {
      await db().insert(videos).values({
        plataforma: "youtube",
        idExterno: `nc-curto-${i}`,
        url: `https://exemplo.invalido/nc-curto-${i}`,
        nichoId,
        contaId: alternadas[i % 2],
        titulo: `[exemplo] curto ${i}`,
        views: 100,
        publicadoEm: new Date(Date.now() - 3 * DIA_MS),
        velocidadeRelativa: String(5 + i),
        idioma: "pt",
        analise: { assunto: "erro comum ao lavar sofa", gancho: "x", estrutura: "x", fechamento: "x", chamadaFinal: "x", formato: "fala_para_camera", porQueFuncionou: "x" } as never,
      });
    }
  }

  afterEach(async () => {
    await db().delete(videos).where(like(videos.idExterno, "nc-curto-%"));
    await db().delete(temasDia).where(eq(temasDia.nichoId, nichoId));
    await db().delete(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"));
  });

  it("a tabela é uma linha por setor e dia, sem marca: não há onde guardar um tema 'da marca A'", async () => {
    expect(Object.keys(temasDia)).not.toContain("clienteId");
  });

  it("com a marca A cheia de resultado no setor, o que o modelo dos temas recebe (sistema e entrada) e o que fica gravado não levam nada dela", async () => {
    await contaComDestaque(marcaA, "conversao", 3, "tema secreto da marca A");
    expect(await desempenhoDaConta(marcaA)).toContain("3,0 vezes");
    await semearCurtosComProva();

    const resumo = await rodarTemasDoDia(nichoId, { forcar: true });
    expect(resumo.gerados).toBe(1);

    const chamadas = vi.mocked(clienteIA.gerarEstruturado).mock.calls.filter(([params]) => params.tarefa === "temasDoDia");
    expect(chamadas.length).toBeGreaterThan(0);
    for (const [params] of chamadas) {
      const texto = `${String(params.sistemaEstavel ?? "")}\n${String(params.entrada)}`;
      expect(texto).not.toContain(TITULO_BLOCO);
      for (const pedaco of ["3,0 vezes", "normal da conta", "secreto", "comprar (4 vídeos)"]) expect(texto).not.toContain(pedaco);
    }

    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linha.temas.length).toBeGreaterThan(0);
    expect(JSON.stringify(linha.temas)).not.toContain("secreto");
    const [geracao] = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"));
    expect(JSON.stringify(geracao.entradas)).not.toContain("secreto");
  });
});
