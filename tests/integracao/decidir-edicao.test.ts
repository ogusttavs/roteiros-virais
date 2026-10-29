/**
 * E47 PR 3, a decisão da edição e o verificador, contra o Postgres real e a IA em mock (nenhuma chamada de verdade à API). Prova:
 *  - o fluxo feliz: `transcrito` vira `verificado`, com o plano de corte, a legenda com o nome da marca certo, o título, a retake descartada, as duas chamadas registradas em `geracoes_ia`
 *    (só números, nunca a fala) e o custo somado na edição;
 *  - a conferência que reprova (índice que não existe, título com número que ninguém falou) dá uma segunda decisão com o motivo; reprovou de novo, `para_revisao`;
 *  - o verificador barato que reprova a legenda nas duas rodadas também leva a `para_revisao`;
 *  - a IA fora do ar devolve a edição ao passo anterior, e na terceira rodada ela falha com a frase; o verificador fora do ar guarda o plano e a rodada seguinte retoma dele, sem pagar a
 *    decisão de novo;
 *  - idempotência, isolamento entre marcas, e a limpeza (parada devolvida, esquecida reenfileirada, expirada sem fala nem plano).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/ia/cliente", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/cliente")>();
  return {
    ...original,
    // Uso de tokens de mentira (o mock devolve zero): o forte gasta 8 mil de entrada e 4 mil de saída, o barato 3 mil e 1 mil. Custo esperado por par: US$ 0,148.
    gerarEstruturado: vi.fn(async (params: Parameters<typeof original.gerarEstruturado>[0]) => {
      const r = await original.gerarEstruturado(params);
      return params.nivel === "forte" ? { ...r, tokensEntrada: 8000, tokensSaida: 4000 } : { ...r, tokensEntrada: 3000, tokensSaida: 1000 };
    }),
  };
});
const fila = vi.hoisted(() => ({ enviados: [] as { fila: string; dados: unknown }[] }));
vi.mock("@/jobs/fila", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/jobs/fila")>();
  return {
    ...original,
    garantirBossPronto: async () => undefined,
    boss: () => ({ send: async (nome: string, dados: unknown) => void fila.enviados.push({ fila: nome, dados }) }),
  };
});

import { TENTATIVAS_DA_DECISAO } from "@/config/edicao";
import { db } from "@/db";
import { briefings, clientes, edicoes, geracoesIA, nichos, roteiros, user } from "@/db/schema";
import { energiaParaBanco } from "@/edicao/guardada";
import { montarFalaSintetica, type FalaSintetica } from "@/edicao/sintetica";
import * as clienteIA from "@/ia/cliente";
import { rodarDecidirEdicao } from "@/jobs/decidir-edicao";
import { rodarLimparEdicoes } from "@/jobs/limpar-edicoes";
import { fraseDaEdicao } from "@/textos/edicao";

import { resetarSchema } from "../../scripts/resetar-schema";

let marcaA: number;
let marcaB: number;

function cenario(): FalaSintetica {
  return montarFalaSintetica([
    { texto: "Pode gravar agora" },
    { texto: "Você sabe por que a mancha", pausaAntes: 1.5 },
    { texto: "Você sabe por que a mancha de café volta sempre?", pausaAntes: 1.3 },
    { texto: "O segredo é passar o Dr.Uosh na direção certa.", pausaAntes: 0.5 },
    { texto: "Experimente hoje e me conte como ficou.", pausaAntes: 0.5 },
  ]);
}

function conteudo(extra: Partial<{ titulo: string; gancho: string }> = {}) {
  return {
    titulo: extra.titulo ?? "Por que a mancha de café volta sempre",
    duracaoS: 40,
    gancho: extra.gancho ?? "Você sabe por que a mancha de café volta sempre?",
    corpo: "O segredo é passar o produto na direção certa.",
    fechamento: "Experimente hoje.",
    chamadaFinal: "Me conte como ficou.",
    cartoes: null,
    porQueAssim: [],
    cenas: [],
    ondeGravar: "em casa",
    edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
    evidencias: [],
    semEvidencia: false,
    forcaEvidencia: null,
  };
}

async function criarRoteiro(clienteId: number, extra: Partial<{ titulo: string; gancho: string }> = {}): Promise<number> {
  const [r] = await db().insert(roteiros).values({ clienteId, data: "2026-10-29", tema: "tema", origem: "sugerido", objetivo: "alcance", conteudo: conteudo(extra) }).returning({ id: roteiros.id });
  return r.id;
}

async function criarEdicao(roteiroId: number, opcoes: { clienteId?: number; estado?: "transcrito" | "decidido" | "verificado"; fala?: FalaSintetica } = {}): Promise<number> {
  const fala = opcoes.fala ?? cenario();
  const [e] = await db()
    .insert(edicoes)
    .values({
      clienteId: opcoes.clienteId ?? marcaA,
      roteiroId,
      estado: opcoes.estado ?? "transcrito",
      tamanhoBytes: 10,
      tipoDoArquivo: "video/mp4",
      duracaoS: fala.duracao.toFixed(3),
      palavras: fala.palavras,
      energia: energiaParaBanco(fala.energia),
    })
    .returning({ id: edicoes.id });
  return e.id;
}

async function linha(id: number) {
  const [l] = await db().select().from(edicoes).where(eq(edicoes.id, id));
  return l;
}

const chamadas = (tarefa: string) => vi.mocked(clienteIA.gerarEstruturado).mock.calls.filter((c) => c[0].tarefa === tarefa).length;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "decisao-teste", nome: "Decisao teste", termos: [] }).returning();
  await db().insert(user).values([
    { id: "dec-dono-a", name: "Dono A", email: "dec-dono-a@exemplo.teste", role: "cliente" },
    { id: "dec-dono-b", name: "Dono B", email: "dec-dono-b@exemplo.teste", role: "cliente" },
  ]);
  const perfis = { instagram: null, tiktok: null, youtube: null };
  const marcas = await db()
    .insert(clientes)
    .values([
      { usuarioId: "dec-dono-a", nome: "Dr.Wash", nichoId: nicho.id, perfis, cidade: "Campinas" },
      { usuarioId: "dec-dono-b", nome: "[teste] Marca Beta", nichoId: nicho.id, perfis },
    ])
    .returning();
  [marcaA, marcaB] = marcas.map((m) => m.id);
  await db().insert(briefings).values({
    clienteId: marcaA,
    completo: true,
    perfil: { fatos: { oQueVende: "limpador de manchas", preco: "", clienteIdeal: "", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] }, resumo: "Marca de produtos de limpeza.", referencias: [] },
  });
}, 120_000);

beforeEach(async () => {
  await db().delete(edicoes);
  await db().delete(geracoesIA);
  vi.mocked(clienteIA.gerarEstruturado).mockClear();
  fila.enviados.length = 0;
});

afterAll(async () => {
  await db().delete(edicoes);
});

describe("o fluxo feliz", () => {
  it("transcrito vira verificado: tira a conversa solta e a abertura largada, acerta o nome da marca e registra custo e tokens", async () => {
    const roteiroId = await criarRoteiro(marcaA);
    const id = await criarEdicao(roteiroId);
    const resumo = await rodarDecidirEdicao(id);
    expect(resumo).toMatchObject({ edicaoId: id, estado: "verificado", decisoes: 1 });

    const e = await linha(id);
    expect(e.estado).toBe("verificado");
    expect(e.motivo).toBeNull();
    expect(e.tentativasDaDecisao).toBe(1);
    const fala = cenario();
    const r = e.resultado!;
    // A abertura completa abre o vídeo; a conversa solta e a abertura largada ficam de fora.
    expect(r.edl.palavrasMantidas[0]).toBe(fala.faixas[2].deIndice);
    expect(r.edl.palavrasMantidas.at(-1)).toBe(fala.faixas[4].ateIndice);
    expect(r.edl.alertas).toEqual([]);
    expect(r.legenda.srt).toContain("-->");
    const legenda = r.legenda.blocos.map((b) => b.texto).join(" ");
    expect(legenda).toContain("DR.WASH");
    expect(legenda).not.toContain("UOSH");
    expect(legenda).not.toContain("PODE GRAVAR");
    expect(r.titulo.texto).toBe("Por que a mancha de café volta sempre");
    expect(r.verificadaEm).not.toBeNull();
    expect(e.decisao!.gancho.tentativasDescartadas).toBe(2);

    // Custo e tokens: uma decisão forte (US$ 0,14) mais um verificador barato (US$ 0,008).
    expect(Number(e.custoIaUsd)).toBeCloseTo(0.148, 5);
    const geracoes = await db().select().from(geracoesIA);
    expect(geracoes.map((g) => g.tarefa).sort()).toEqual(["decidirEdicao", "verificarEdicao"]);
    expect(geracoes.every((g) => g.clienteId === marcaA)).toBe(true);
    const forte = geracoes.find((g) => g.tarefa === "decidirEdicao")!;
    expect(forte.tokensEntrada).toBe(8000);
    expect(forte.tokensSaida).toBe(4000);
    expect(Number(forte.custoUsd)).toBeCloseTo(0.14, 5);
    // A fala da pessoa nunca vai para o registro: só o número de palavras e a tentativa.
    expect(forte.entradas).toEqual({ edicaoId: id, tentativa: 1, palavras: fala.palavras.length });
  });

  it("quando o plano fica pronto a prévia entra na fila do render (E47 PR 4); a fila que falha não derruba a decisão", async () => {
    const id = await criarEdicao(await criarRoteiro(marcaA));
    const pedidos: unknown[][] = [];
    await rodarDecidirEdicao(id, { enfileirarRender: async (...args) => void pedidos.push(args) });
    expect(pedidos).toEqual([[id, "previa", 0]]);
    expect((await linha(id)).estado).toBe("verificado");

    const outro = await criarEdicao(await criarRoteiro(marcaA));
    await rodarDecidirEdicao(outro, {
      enfileirarRender: async () => {
        throw new Error("fila fora do ar");
      },
    });
    expect((await linha(outro)).estado).toBe("verificado");
  });

  it("o que a pessoa pediu ao refazer entra já na primeira decisão da rodada, como motivo da anterior (E47 PR 4)", async () => {
    const id = await criarEdicao(await criarRoteiro(marcaA));
    await db().update(edicoes).set({ pedidosDeAjuste: ["Deixe a abertura mais curta", "Mantenha a parte do preço"] }).where(eq(edicoes.id, id));
    await rodarDecidirEdicao(id, { enfileirarRender: async () => undefined });
    const primeira = vi.mocked(clienteIA.gerarEstruturado).mock.calls.filter((c) => c[0].tarefa === "decidirEdicao")[0][0];
    expect(primeira.entrada).toContain("ATENÇÃO: a decisão anterior");
    expect(primeira.entrada).toContain("a pessoa assistiu à prévia e pediu para refazer");
    expect(primeira.entrada).toContain("Deixe a abertura mais curta");
    expect(primeira.entrada).toContain("Mantenha a parte do preço");
    // Sem pedido, a primeira decisão não leva o aviso.
    vi.mocked(clienteIA.gerarEstruturado).mockClear();
    const limpo = await criarEdicao(await criarRoteiro(marcaA));
    await rodarDecidirEdicao(limpo, { enfileirarRender: async () => undefined });
    expect(vi.mocked(clienteIA.gerarEstruturado).mock.calls.filter((c) => c[0].tarefa === "decidirEdicao")[0][0].entrada).not.toContain("a decisão anterior");
  });

  it("é idempotente: rodar de novo uma edição que já terminou não faz nada nem gasta", async () => {
    const id = await criarEdicao(await criarRoteiro(marcaA));
    await rodarDecidirEdicao(id);
    vi.mocked(clienteIA.gerarEstruturado).mockClear();
    expect(await rodarDecidirEdicao(id)).toEqual({ edicaoId: id, pulou: "verificado" });
    expect(await rodarDecidirEdicao(987654)).toEqual({ edicaoId: 987654, pulou: "inexistente" });
    expect(chamadas("decidirEdicao")).toBe(0);
  });
});

describe("a conferência que reprova", () => {
  it("índice que não existe na primeira decisão: a segunda leva o motivo e a edição termina verificada", async () => {
    const id = await criarEdicao(await criarRoteiro(marcaA, { gancho: "Você sabe por que a mancha volta? [mock:edicao-indice-ruim]" }));
    const resumo = await rodarDecidirEdicao(id);
    expect(resumo).toMatchObject({ estado: "verificado", decisoes: 2 });
    expect(chamadas("decidirEdicao")).toBe(2);
    const segunda = vi.mocked(clienteIA.gerarEstruturado).mock.calls.filter((c) => c[0].tarefa === "decidirEdicao")[1][0];
    expect(segunda.entrada).toContain("ATENÇÃO: a decisão anterior");
    expect(segunda.entrada).toContain("não existe");
    expect((await linha(id)).resultado!.tentativas).toBe(2);
  });

  it("título com número que ninguém falou na primeira decisão: a segunda corrige", async () => {
    const id = await criarEdicao(await criarRoteiro(marcaA, { titulo: "Por que a mancha volta [mock:edicao-titulo-ruim-1a]" }));
    expect(await rodarDecidirEdicao(id)).toMatchObject({ estado: "verificado", decisoes: 2 });
    const segunda = vi.mocked(clienteIA.gerarEstruturado).mock.calls.filter((c) => c[0].tarefa === "decidirEdicao")[1][0];
    expect(segunda.entrada).toContain("número 999");
  });

  it("reprovou nas duas decisões: para revisão, sem verificador, com a frase para a pessoa", async () => {
    const id = await criarEdicao(await criarRoteiro(marcaA, { gancho: "Você sabe? [mock:edicao-sempre-ruim]" }));
    expect(await rodarDecidirEdicao(id)).toMatchObject({ estado: "para_revisao", decisoes: 2 });
    const e = await linha(id);
    expect(e.estado).toBe("para_revisao");
    expect(e.motivo).toBe(fraseDaEdicao("em-revisao"));
    expect(chamadas("decidirEdicao")).toBe(2);
    expect(chamadas("verificarEdicao")).toBe(0);
  });

  it("o verificador barato reprova a legenda nas duas rodadas: para revisão, com o motivo guardado e as duas chamadas pagas", async () => {
    const id = await criarEdicao(await criarRoteiro(marcaA, { gancho: "Você sabe? [mock:edicao-nome-errado]" }));
    expect(await rodarDecidirEdicao(id)).toMatchObject({ estado: "para_revisao" });
    const e = await linha(id);
    expect(e.estado).toBe("para_revisao");
    expect(e.resultado!.problemas.join(" ")).toContain("nome da marca");
    expect(chamadas("decidirEdicao")).toBe(2);
    expect(chamadas("verificarEdicao")).toBe(2);
    expect(Number(e.custoIaUsd)).toBeCloseTo(2 * 0.148, 5);
  });

  it("um aviso do verificador (gravidade aviso) não trava: a edição termina verificada com o aviso para a pessoa", async () => {
    const id = await criarEdicao(await criarRoteiro(marcaA, { gancho: "Você sabe? [mock:edicao-aviso]" }));
    expect(await rodarDecidirEdicao(id)).toMatchObject({ estado: "verificado", decisoes: 1 });
    expect((await linha(id)).resultado!.avisos).toEqual(["Uma frase ficou informal."]);
  });
});

describe("a IA fora do ar", () => {
  it("a decisão fora do ar devolve a edição ao passo anterior, e na terceira rodada ela falha com a frase e o bruto sai", async () => {
    const id = await criarEdicao(await criarRoteiro(marcaA, { gancho: "Você sabe? [mock:edicao-fora]" }));
    for (let rodada = 1; rodada < TENTATIVAS_DA_DECISAO; rodada++) {
      await expect(rodarDecidirEdicao(id)).rejects.toThrow();
      const e = await linha(id);
      expect(e.estado).toBe("transcrito");
      expect(e.tentativasDaDecisao).toBe(rodada);
      expect(e.palavras).not.toBeNull();
    }
    await expect(rodarDecidirEdicao(id)).rejects.toThrow();
    const f = await linha(id);
    expect(f.estado).toBe("falhou");
    expect(f.motivo).toBe(fraseDaEdicao("nao-montou"));
    expect(f.palavras).toBeNull();
    expect(f.resultado).toBeNull();
  });

  it("o verificador fora do ar guarda o plano (decidido), e a rodada seguinte retoma dele sem pagar a decisão de novo", async () => {
    const roteiroId = await criarRoteiro(marcaA, { gancho: "Você sabe? [mock:verificador-fora]" });
    const id = await criarEdicao(roteiroId);
    await expect(rodarDecidirEdicao(id)).rejects.toThrow();
    const parada = await linha(id);
    expect(parada.estado).toBe("decidido");
    expect(parada.resultado).not.toBeNull();
    expect(chamadas("decidirEdicao")).toBe(1);

    // A IA do verificador volta: tira o marcador do roteiro e roda de novo.
    await db()
      .update(roteiros)
      .set({ conteudo: conteudo({ gancho: "Você sabe por que a mancha de café volta sempre?" }) })
      .where(eq(roteiros.id, roteiroId));
    vi.mocked(clienteIA.gerarEstruturado).mockClear();
    expect(await rodarDecidirEdicao(id)).toMatchObject({ estado: "verificado", decisoes: 1 });
    expect(chamadas("decidirEdicao")).toBe(0);
    expect(chamadas("verificarEdicao")).toBe(1);
    expect((await linha(id)).tentativasDaDecisao).toBe(2);
  });
});

describe("isolamento", () => {
  it("o roteiro de outra marca nunca entra: a edição falha sem chamar a IA", async () => {
    const roteiroDeB = await criarRoteiro(marcaB);
    const id = await criarEdicao(roteiroDeB, { clienteId: marcaA });
    expect(await rodarDecidirEdicao(id)).toMatchObject({ estado: "falhou", motivo: "sem-roteiro-ou-marca" });
    expect(chamadas("decidirEdicao")).toBe(0);
    expect((await linha(id)).motivo).toBe(fraseDaEdicao("nao-achou"));
  });
});

describe("a limpeza cuida da decisão", () => {
  const agora = new Date();
  const horasAtras = (h: number) => new Date(agora.getTime() - h * 3_600_000);

  it("reenfileira a decisão esquecida (transcrito ou decidido há mais de 10 minutos), e não a recente nem a que já gastou as rodadas", async () => {
    const roteiroId = await criarRoteiro(marcaA);
    const velha = await criarEdicao(roteiroId);
    const velhaDecidida = await criarEdicao(roteiroId, { estado: "decidido" });
    const recente = await criarEdicao(roteiroId);
    const gastou = await criarEdicao(roteiroId);
    await db().update(edicoes).set({ atualizadaEm: horasAtras(1) }).where(eq(edicoes.id, velha));
    await db().update(edicoes).set({ atualizadaEm: horasAtras(1) }).where(eq(edicoes.id, velhaDecidida));
    await db().update(edicoes).set({ atualizadaEm: new Date(agora.getTime() - 60_000) }).where(eq(edicoes.id, recente));
    await db().update(edicoes).set({ atualizadaEm: horasAtras(1), tentativasDaDecisao: TENTATIVAS_DA_DECISAO }).where(eq(edicoes.id, gastou));
    const enfileiradas: number[] = [];
    const resumo = await rodarLimparEdicoes({ agora: () => agora, enfileirar: async () => undefined, enfileirarDecisao: async (id) => void enfileiradas.push(id) });
    expect(enfileiradas.sort()).toEqual([velha, velhaDecidida].sort());
    expect(resumo).toMatchObject({ decisoesReenfileiradas: 2 });
  });

  it("a decisão parada no meio (decidindo há mais de 20 minutos) volta ao passo anterior, e na terceira rodada falha com a frase", async () => {
    const roteiroId = await criarRoteiro(marcaA);
    const semPlano = await criarEdicao(roteiroId);
    const comPlano = await criarEdicao(roteiroId);
    const esgotada = await criarEdicao(roteiroId);
    const fala = cenario();
    const plano = { edl: {} as never, legenda: { blocos: [], srt: "", palavrasChave: [] }, titulo: { texto: "T", subtitulo: null }, avisos: [], tentativas: 1, problemas: [], verificadaEm: null };
    await db().update(edicoes).set({ estado: "decidindo", tentativasDaDecisao: 1, atualizadaEm: horasAtras(1) }).where(eq(edicoes.id, semPlano));
    await db().update(edicoes).set({ estado: "decidindo", tentativasDaDecisao: 1, atualizadaEm: horasAtras(1), resultado: plano }).where(eq(edicoes.id, comPlano));
    await db().update(edicoes).set({ estado: "decidindo", tentativasDaDecisao: TENTATIVAS_DA_DECISAO, atualizadaEm: horasAtras(1) }).where(eq(edicoes.id, esgotada));
    const resumo = await rodarLimparEdicoes({ agora: () => agora, enfileirar: async () => undefined, enfileirarDecisao: async () => undefined });
    expect(resumo).toMatchObject({ decisoesDevolvidas: 2, decisoesDesistidas: 1 });
    expect((await linha(semPlano)).estado).toBe("transcrito");
    expect((await linha(comPlano)).estado).toBe("decidido");
    const f = await linha(esgotada);
    expect(f.estado).toBe("falhou");
    expect(f.motivo).toBe(fraseDaEdicao("nao-montou"));
    expect(f.palavras).toBeNull();
    expect(fala.palavras.length).toBeGreaterThan(0);
  });

  it("quando o bruto vence, a edição expira e a decisão e o plano (que têm a fala) saem junto", async () => {
    const id = await criarEdicao(await criarRoteiro(marcaA));
    await rodarDecidirEdicao(id);
    expect((await linha(id)).resultado).not.toBeNull();
    await db().update(edicoes).set({ brutoExpiraEm: horasAtras(1) }).where(eq(edicoes.id, id));
    await rodarLimparEdicoes({ agora: () => agora, enfileirar: async () => undefined, enfileirarDecisao: async () => undefined });
    const e = await linha(id);
    expect(e.estado).toBe("expirada");
    expect(e.resultado).toBeNull();
    expect(e.decisao).toBeNull();
    expect(e.palavras).toBeNull();
  });
});
