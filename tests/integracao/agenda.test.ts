/**
 * `semanaDaAgenda` (A3: a janela de sete dias a partir de hoje), `inicioDaJanelaISO` e `agendaDoDia` (`servicos/roteiro.ts`, E39a): a tira da semana e o conteúdo
 * de um dia da nova Agenda, contra o Postgres real. E39b: `atrasados`, `arquivarRoteiro`,
 * `mudarDataRoteiro`, `conferirAindaVale` e `mesDaAgenda`, mesma suíte.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, planoGravacoes, roteiros, user, videos } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import {
  agendaDoDia,
  arquivarRoteiro,
  atrasados,
  conferirAindaVale,
  ErroRoteiro,
  inicioDaJanelaISO,
  mesDaAgenda,
  mudarDataRoteiro,
  roteiroPorId,
  semanaDaAgenda,
  somarDiasISO,
} from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

const CONTEUDO_ROTEIRO_MINIMO = {
  titulo: "titulo",
  duracaoS: 40,
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

type OpcoesRoteiro = {
  formato: "reels" | "story";
  momentoDoDia?: "manha" | "meio_dia" | "fim_tarde" | "noite";
  titulo?: string;
  status?: "gerado" | "gravado" | "postado";
  criadoEm?: Date;
  arquivadoEm?: Date | null;
};

async function criarRoteiro(clienteId: number, data: string, opcoes: OpcoesRoteiro) {
  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data,
      tema: `tema de ${data}`,
      origem: "sugerido",
      objetivo: "alcance",
      formato: opcoes.formato,
      momentoDoDia: opcoes.momentoDoDia,
      conteudo: { ...CONTEUDO_ROTEIRO_MINIMO, titulo: opcoes.titulo ?? `titulo de ${data}` },
      status: opcoes.status ?? "gerado",
      arquivadoEm: opcoes.arquivadoEm ?? null,
      ...(opcoes.criadoEm ? { criadoEm: opcoes.criadoEm } : {}),
    })
    .returning();
  return roteiro;
}

function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

/** E39b, item (a): um vídeo "subindo hoje" do setor, candidato a "ainda vale?" (`subindoHojeComAnalise`). */
async function criarVideoSubindo(
  nichoIdDoVideo: number,
  opcoes: { idExterno: string; assunto: string; velocidadeRelativa: number },
) {
  await db()
    .insert(videos)
    .values({
      plataforma: "tiktok",
      idExterno: opcoes.idExterno,
      url: `https://exemplo.invalido/${opcoes.idExterno}`,
      nichoId: nichoIdDoVideo,
      views: 999_999,
      publicadoEm: diasAtras(3),
      velocidadeRelativa: String(opcoes.velocidadeRelativa),
      // `as never`: a ficha mínima de teste não precisa dos outros campos de `AnaliseVideo`
      // (mesma técnica de `tests/integracao/pesquisa.test.ts`, `criarVideo`).
      analise: { assunto: opcoes.assunto, pertenceAoNicho: true } as never,
    });
}

let nichoId: number;
let marcaA: { id: number; usuarioId: string };
let marcaB: { id: number; usuarioId: string };

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "agenda-teste", nome: "Agenda teste" }).returning();
  nichoId = nicho.id;

  await db()
    .insert(user)
    .values([
      { id: "agenda-a", name: "[teste] Agenda A", email: "a@agenda.teste" },
      { id: "agenda-b", name: "[teste] Agenda B", email: "b@agenda.teste" },
    ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "agenda-a", nome: "[teste] Marca A", nichoId }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "agenda-b", nome: "[teste] Marca B", nichoId }).returning();
  marcaA = { id: a.id, usuarioId: a.usuarioId! };
  marcaB = { id: b.id, usuarioId: b.usuarioId! };
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("semanaDaAgenda (A3: os sete dias a partir de hoje)", () => {
  const hoje = hojeISO();

  it("a janela comeca em hoje e tem sete dias, com o nome curto do dia da semana de cada um", async () => {
    const semana = await semanaDaAgenda(marcaA.id, hoje);
    expect(semana.map((d) => d.data)).toEqual(Array.from({ length: 7 }, (_, i) => somarDiasISO(hoje, i)));
    expect(semana[0]!.hoje).toBe(true);
    expect(semana.slice(1).some((d) => d.hoje)).toBe(false);
    expect(semana.some((d) => d.passado)).toBe(false);
    const nomes = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
    const [ano, mes, dia] = hoje.split("-").map(Number);
    const hojeDow = new Date(Date.UTC(ano, mes - 1, dia, 12)).getUTCDay();
    expect(semana.map((d) => d.diaDaSemanaCurto)).toEqual(Array.from({ length: 7 }, (_, i) => nomes[(hojeDow + i) % 7]));
  });

  it("uma data no meio da janela devolve a mesma janela (tocar num dia nao desloca a faixa)", async () => {
    const daqui3 = await semanaDaAgenda(marcaA.id, somarDiasISO(hoje, 3));
    expect(daqui3[0]!.data).toBe(hoje);
    const daqui6 = await semanaDaAgenda(marcaA.id, somarDiasISO(hoje, 6));
    expect(daqui6[0]!.data).toBe(hoje);
  });

  it("a janela anterior e a seguinte sao os blocos de sete dias vizinhos, e a anterior vem toda como passado", async () => {
    const anterior = await semanaDaAgenda(marcaA.id, somarDiasISO(hoje, -7));
    expect(anterior[0]!.data).toBe(somarDiasISO(hoje, -7));
    expect(anterior[6]!.data).toBe(somarDiasISO(hoje, -1));
    expect(anterior.every((d) => d.passado && !d.hoje)).toBe(true);
    const seguinte = await semanaDaAgenda(marcaA.id, somarDiasISO(hoje, 7));
    expect(seguinte[0]!.data).toBe(somarDiasISO(hoje, 7));
    const diaMeio = await semanaDaAgenda(marcaA.id, somarDiasISO(hoje, -1));
    expect(diaMeio[0]!.data).toBe(somarDiasISO(hoje, -7));
  });

  it("conta reels e stories por dia, isolado por marca, so a ponta de cada serie", async () => {
    const d1 = somarDiasISO(hoje, 1);
    const d3 = somarDiasISO(hoje, 3);
    await criarRoteiro(marcaA.id, d1, { formato: "reels" });
    await criarRoteiro(marcaA.id, d3, { formato: "story", momentoDoDia: "manha" });
    await criarRoteiro(marcaA.id, d3, { formato: "story", momentoDoDia: "noite" });
    // Marca B nao pode aparecer na semana de A.
    await criarRoteiro(marcaB.id, d1, { formato: "reels" });

    const semana = await semanaDaAgenda(marcaA.id, hoje);
    expect(semana[0]!.marca).toEqual({ qtdReels: 0, qtdStories: 0 });
    expect(semana.find((d) => d.data === d1)!.marca).toEqual({ qtdReels: 1, qtdStories: 0 });
    expect(semana.find((d) => d.data === d3)!.marca).toEqual({ qtdReels: 0, qtdStories: 2 });
  });

  it("o plano e quantos roteiros quiser por dia: dois Reels no mesmo dia contam os dois (revisao do Fable no PR #90)", async () => {
    const d5 = somarDiasISO(hoje, 5);
    await criarRoteiro(marcaA.id, d5, { formato: "reels", titulo: "primeiro reels do dia" });
    await criarRoteiro(marcaA.id, d5, { formato: "reels", titulo: "segundo reels do dia" });

    const semana = await semanaDaAgenda(marcaA.id, hoje);
    expect(semana.find((d) => d.data === d5)!.marca).toEqual({ qtdReels: 2, qtdStories: 0 });
  });

  it("o campo hoje e true so no dia de hoje de verdade", async () => {
    const semana = await semanaDaAgenda(marcaA.id, hoje);
    const diasDeHoje = semana.filter((d) => d.hoje);
    expect(diasDeHoje).toHaveLength(1);
    expect(diasDeHoje[0]!.data).toBe(hoje);
  });
});

describe("inicioDaJanelaISO (A3)", () => {
  // 2026-10-03 e um sabado; 2026-10-07 e uma quarta-feira. A janela nunca depende do dia da semana, so de hoje.
  it.each(["2026-10-03", "2026-10-07", "2026-10-04", "2026-10-05"])("hoje %s: a janela de hoje comeca em hoje e vai 6 dias a frente", (hoje) => {
    for (let i = 0; i < 7; i++) expect(inicioDaJanelaISO(somarDiasISO(hoje, i), hoje)).toBe(hoje);
    expect(inicioDaJanelaISO(somarDiasISO(hoje, 7), hoje)).toBe(somarDiasISO(hoje, 7));
    expect(inicioDaJanelaISO(somarDiasISO(hoje, -1), hoje)).toBe(somarDiasISO(hoje, -7));
    expect(inicioDaJanelaISO(somarDiasISO(hoje, -7), hoje)).toBe(somarDiasISO(hoje, -7));
    expect(inicioDaJanelaISO(somarDiasISO(hoje, -8), hoje)).toBe(somarDiasISO(hoje, -14));
  });

  it("no sabado a janela mostra a segunda e a terca que vem; a anterior e '26 de set a 2 de out' para hoje 3 de out", () => {
    expect(inicioDaJanelaISO("2026-10-05", "2026-10-03")).toBe("2026-10-03");
    expect(inicioDaJanelaISO("2026-10-02", "2026-10-03")).toBe("2026-09-26");
  });
});

describe("agendaDoDia", () => {
  it("devolve o reels e os stories ordenados pela parte do dia", async () => {
    await criarRoteiro(marcaA.id, "2026-09-21", { formato: "reels", titulo: "o reels do dia" });
    await criarRoteiro(marcaA.id, "2026-09-21", { formato: "story", momentoDoDia: "noite", titulo: "story da noite" });
    await criarRoteiro(marcaA.id, "2026-09-21", { formato: "story", momentoDoDia: "manha", titulo: "story da manha" });
    await criarRoteiro(marcaA.id, "2026-09-21", { formato: "story", titulo: "story sem momento ainda" });

    const agenda = await agendaDoDia(marcaA.id, "2026-09-21");

    expect(agenda.reels.map((r) => r.titulo)).toEqual(["o reels do dia"]);
    expect(agenda.stories.map((s) => s.titulo)).toEqual([
      "story da manha",
      "story da noite",
      "story sem momento ainda",
    ]);
  });

  it("dia sem nada marcado devolve as duas listas vazias", async () => {
    const agenda = await agendaDoDia(marcaA.id, "2026-09-22");
    expect(agenda.reels).toEqual([]);
    expect(agenda.stories).toEqual([]);
  });

  it("e isolado por marca", async () => {
    await criarRoteiro(marcaB.id, "2026-09-23", { formato: "reels", titulo: "reels da marca B" });
    const agendaDeA = await agendaDoDia(marcaA.id, "2026-09-23");
    expect(agendaDeA.reels).toEqual([]);
  });

  /**
   * Revisão do Fable no PR #90: o plano é "quantos roteiros quiser por dia", nunca só um Reels
   * escondendo os outros. Ordem: a gravar antes de gravado antes de postado; dentro do mesmo
   * estado, o mais antigo primeiro (o primeiro a gravar é o destaque da tela).
   */
  it("mais de um Reels no mesmo dia: a gravar antes de gravado antes de postado, o mais antigo primeiro dentro do mesmo estado", async () => {
    await criarRoteiro(marcaA.id, "2026-09-24", { formato: "reels", titulo: "postado ontem", status: "postado" });
    await criarRoteiro(marcaA.id, "2026-09-24", { formato: "reels", titulo: "a gravar, criado primeiro" });
    await criarRoteiro(marcaA.id, "2026-09-24", { formato: "reels", titulo: "gravado" , status: "gravado" });
    await criarRoteiro(marcaA.id, "2026-09-24", { formato: "reels", titulo: "a gravar, criado depois" });

    const agenda = await agendaDoDia(marcaA.id, "2026-09-24");

    expect(agenda.reels.map((r) => r.titulo)).toEqual([
      "a gravar, criado primeiro",
      "a gravar, criado depois",
      "gravado",
      "postado ontem",
    ]);
  });

  it("um atrasado arquivado nao aparece mais no dia que era dele (E39b, item b)", async () => {
    const hoje = hojeISO();
    const diaPassado = somarDiasISO(hoje, -5);
    const roteiro = await criarRoteiro(marcaA.id, diaPassado, { formato: "reels", titulo: "vai ser arquivado" });

    await arquivarRoteiro(roteiro.id);
    const agenda = await agendaDoDia(marcaA.id, diaPassado);

    expect(agenda.reels).toEqual([]);
  });
});

describe("atrasados", () => {
  it("o que estava marcado para um dia que ja passou e continua 'a gravar', mais antigo primeiro, nunca arquivado nem de hoje", async () => {
    const hoje = hojeISO();
    await criarRoteiro(marcaA.id, somarDiasISO(hoje, -3), { formato: "reels", titulo: "atrasado de 3 dias" });
    await criarRoteiro(marcaA.id, somarDiasISO(hoje, -1), { formato: "story", titulo: "atrasado de ontem" });
    await criarRoteiro(marcaA.id, somarDiasISO(hoje, -2), { formato: "reels", titulo: "gravado, nao conta", status: "gravado" });
    await criarRoteiro(marcaA.id, hoje, { formato: "reels", titulo: "hoje, nao e atrasado" });
    const arquivado = await criarRoteiro(marcaA.id, somarDiasISO(hoje, -4), { formato: "reels", titulo: "arquivado, nao conta" });
    await arquivarRoteiro(arquivado.id);

    // marcaA acumula roteiros de outros testes deste arquivo (sem limpeza entre `it`s, convenção
    // já usada aqui); confere só os títulos novos, por conteúdo e ordem, não a lista inteira.
    const titulos = (await atrasados(marcaA.id, hoje)).map((i) => i.titulo);

    expect(titulos).toContain("atrasado de 3 dias");
    expect(titulos).toContain("atrasado de ontem");
    expect(titulos.indexOf("atrasado de 3 dias")).toBeLessThan(titulos.indexOf("atrasado de ontem"));
    expect(titulos).not.toContain("gravado, nao conta");
    expect(titulos).not.toContain("hoje, nao e atrasado");
    expect(titulos).not.toContain("arquivado, nao conta");
  });

  it("e isolado por marca", async () => {
    const hoje = hojeISO();
    await criarRoteiro(marcaB.id, somarDiasISO(hoje, -2), { formato: "reels", titulo: "atrasado da marca B" });

    const listaDeA = await atrasados(marcaA.id, hoje);

    expect(listaDeA.some((i) => i.titulo === "atrasado da marca B")).toBe(false);
  });
});

describe("arquivarRoteiro", () => {
  it("marca arquivadoEm; o roteiro continua existindo (so sai da agenda, nao do banco)", async () => {
    const hoje = hojeISO();
    const roteiro = await criarRoteiro(marcaA.id, somarDiasISO(hoje, -2), { formato: "reels", titulo: "para arquivar" });

    await arquivarRoteiro(roteiro.id);

    const atual = await roteiroPorId(roteiro.id, marcaA.id);
    expect(atual?.arquivadoEm).not.toBeNull();
    const lista = await atrasados(marcaA.id, hoje);
    expect(lista.some((i) => i.id === roteiro.id)).toBe(false);
  });
});

describe("mudarDataRoteiro", () => {
  it("muda a data do roteiro para uma data valida", async () => {
    const hoje = hojeISO();
    const roteiro = await criarRoteiro(marcaA.id, somarDiasISO(hoje, -2), { formato: "reels", titulo: "vai mudar de dia" });

    await mudarDataRoteiro(roteiro.id, somarDiasISO(hoje, 3));

    const atual = await roteiroPorId(roteiro.id, marcaA.id);
    expect(atual?.data).toBe(somarDiasISO(hoje, 3));
  });

  it("recusa data no passado (mesma regra de validarData)", async () => {
    const hoje = hojeISO();
    const roteiro = await criarRoteiro(marcaA.id, somarDiasISO(hoje, -2), { formato: "reels", titulo: "nao pode voltar" });

    await expect(mudarDataRoteiro(roteiro.id, somarDiasISO(hoje, -1))).rejects.toThrow(ErroRoteiro);
  });
});

describe("conferirAindaVale", () => {
  it("sem nada subindo mais forte que o limiar: continua valendo, guardado para nao repetir a chamada", async () => {
    const hoje = hojeISO();
    const roteiro = await criarRoteiro(marcaA.id, hoje, { formato: "reels", titulo: "feito ha 3 dias", criadoEm: diasAtras(3) });

    const resultado = await conferirAindaVale(roteiro.id);

    expect(resultado).toEqual({ vale: true });
    const atual = await roteiroPorId(roteiro.id, marcaA.id);
    expect(atual?.aindaValeChecadoEm).not.toBeNull();
    expect(atual?.aindaValeResultado).toEqual({ vale: true });
  });

  /** Revisão do Fable no PR #91: a resposta guardada só vale no dia em que foi conferida. */
  it("resposta conferida ontem nao vale hoje: confere de novo e regrava a data", async () => {
    const hoje = hojeISO();
    const roteiro = await criarRoteiro(marcaA.id, hoje, { formato: "reels", titulo: "conferido ontem", criadoEm: diasAtras(3) });
    const ontem = diasAtras(1);
    await db()
      .update(roteiros)
      .set({ aindaValeChecadoEm: ontem, aindaValeResultado: { vale: false, videoId: 999999, assunto: "resposta velha" } })
      .where(eq(roteiros.id, roteiro.id));

    const resultado = await conferirAindaVale(roteiro.id);

    expect(resultado).toEqual({ vale: true });
    const atual = await roteiroPorId(roteiro.id, marcaA.id);
    expect(atual?.aindaValeResultado).toEqual({ vale: true });
    expect(hojeISO(atual!.aindaValeChecadoEm!)).toBe(hoje);
  });

  it("com algo subindo mais forte (mock: 3x ou mais): troca, guarda o id e o assunto do candidato", async () => {
    const hoje = hojeISO();
    const nichoForte = (await db().insert(nichos).values({ slug: "agenda-ainda-vale", nome: "Agenda ainda vale" }).returning())[0];
    const clienteForte = (
      await db().insert(clientes).values({ usuarioId: marcaA.usuarioId, nome: "[teste] marca ainda vale", nichoId: nichoForte.id }).returning()
    )[0];
    await criarVideoSubindo(nichoForte.id, { idExterno: "av-forte", assunto: "um jeito novo de limpar estofado", velocidadeRelativa: 6.2 });
    const roteiro = await criarRoteiro(clienteForte.id, hoje, { formato: "reels", titulo: "feito ha 3 dias", criadoEm: diasAtras(3) });

    const resultado = await conferirAindaVale(roteiro.id);

    expect(resultado).toEqual({ vale: false, videoId: expect.any(Number), assunto: "um jeito novo de limpar estofado" });
  });

  it("chamada repetida nao recalcula: devolve o mesmo resultado guardado", async () => {
    const hoje = hojeISO();
    const roteiro = await criarRoteiro(marcaA.id, hoje, { formato: "reels", titulo: "feito ha 3 dias de novo", criadoEm: diasAtras(3) });

    const primeira = await conferirAindaVale(roteiro.id);
    const segunda = await conferirAindaVale(roteiro.id);

    expect(segunda).toEqual(primeira);
  });
});

describe("mesDaAgenda", () => {
  it("a grade cobre semanas completas, com os dias do mes vizinho marcados como fora do mes", async () => {
    // Outubro de 2026 comeca numa quinta-feira; a grade comeca na segunda anterior (28/09).
    const dias = await mesDaAgenda(marcaA.id, "2026-10");

    expect(dias[0].data).toBe("2026-09-28");
    expect(dias[0].foraDoMes).toBe(true);
    expect(dias.find((d) => d.data === "2026-10-01")?.foraDoMes).toBe(false);
    expect(dias.length % 7).toBe(0);
  });

  it("marca atrasado por dia (status gerado, data passada, nao arquivado), nunca por item arquivado", async () => {
    const [nicho] = await db().insert(nichos).values({ slug: "agenda-mes-teste", nome: "Agenda mes teste" }).returning();
    const [marca] = await db().insert(clientes).values({ usuarioId: marcaA.usuarioId, nome: "[teste] marca mes", nichoId: nicho.id }).returning();

    const hoje = hojeISO();
    const diaAtrasado = somarDiasISO(hoje, -2);
    const diaArquivado = somarDiasISO(hoje, -1);
    await criarRoteiro(marca.id, diaAtrasado, { formato: "reels", titulo: "atrasado no mes" });
    const arquivado = await criarRoteiro(marca.id, diaArquivado, { formato: "story", titulo: "arquivado no mes" });
    await arquivarRoteiro(arquivado.id);

    const dias = await mesDaAgenda(marca.id, hoje.slice(0, 7));

    const diaComAtrasado = dias.find((d) => d.data === diaAtrasado)!;
    const diaComArquivado = dias.find((d) => d.data === diaArquivado)!;
    expect(diaComAtrasado.atrasado).toBe(true);
    expect(diaComAtrasado.marca.qtdReels).toBe(1);
    expect(diaComArquivado.atrasado).toBe(false);
    expect(diaComArquivado.marca.qtdStories).toBe(0);
  });

  it("E39c, parte 1: um item do plano ainda sugerido marca o dia, mas um ja aceito (com roteiro) nao conta em dobro", async () => {
    const [nicho] = await db().insert(nichos).values({ slug: "agenda-mes-plano-teste", nome: "Agenda mes plano teste" }).returning();
    const [marca] = await db().insert(clientes).values({ usuarioId: marcaA.usuarioId, nome: "[teste] marca mes plano", nichoId: nicho.id }).returning();

    const hoje = hojeISO();
    const diaSoSugerido = somarDiasISO(hoje, 2);
    const diaJaAceito = somarDiasISO(hoje, 3);

    await db().insert(planoGravacoes).values({
      clienteId: marca.id,
      dia: diaSoSugerido,
      ordem: 1,
      lugar: "oficina",
      situacao: "trocando o oleo",
      oQueMostrar: "o carro no elevador",
      objetivo: "alcance",
      formato: "story",
      estado: "sugerido",
    });

    const roteiroAceito = await criarRoteiro(marca.id, diaJaAceito, { formato: "reels", titulo: "ja aceito" });
    await db().insert(planoGravacoes).values({
      clienteId: marca.id,
      dia: diaJaAceito,
      ordem: 1,
      lugar: "oficina",
      situacao: "entrega ao cliente",
      oQueMostrar: "a chave na mao",
      objetivo: "alcance",
      formato: "reels",
      estado: "aceito",
      roteiroId: roteiroAceito.id,
    });

    const dias = await mesDaAgenda(marca.id, hoje.slice(0, 7));
    const diaSugerido = dias.find((d) => d.data === diaSoSugerido);
    const diaAceito = dias.find((d) => d.data === diaJaAceito);

    expect(diaSugerido?.marca.qtdStories).toBe(1);
    expect(diaAceito?.marca.qtdReels).toBe(1);
  });
});
