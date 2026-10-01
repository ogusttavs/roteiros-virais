/**
 * `semanaDaAgenda` e `agendaDoDia` (`servicos/roteiro.ts`, E39a): a tira da semana e o conteúdo
 * de um dia da nova Agenda, contra o Postgres real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, roteiros, user } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { agendaDoDia, semanaDaAgenda } from "@/servicos/roteiro";

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
    })
    .returning();
  return roteiro;
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

describe("semanaDaAgenda", () => {
  it("a semana e sempre segunda a domingo, mesmo com a data de referencia no meio dela", async () => {
    // 2026-09-16 e uma quarta-feira; a semana que a contem vai de 2026-09-14 (segunda) a 2026-09-20 (domingo).
    const semana = await semanaDaAgenda(marcaA.id, "2026-09-16");
    expect(semana.map((d) => d.data)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
    expect(semana.map((d) => d.diaDaSemanaCurto)).toEqual(["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]);
    expect(semana.map((d) => d.diaDoMes)).toEqual([14, 15, 16, 17, 18, 19, 20]);
  });

  it("uma data de referencia num domingo ainda devolve a semana que comecou na segunda anterior", async () => {
    // 2026-09-20 e um domingo; a semana e a mesma do teste acima.
    const semana = await semanaDaAgenda(marcaA.id, "2026-09-20");
    expect(semana[0].data).toBe("2026-09-14");
    expect(semana[6].data).toBe("2026-09-20");
  });

  it("conta reels e stories por dia, isolado por marca, so a ponta de cada serie", async () => {
    await criarRoteiro(marcaA.id, "2026-09-15", { formato: "reels" });
    await criarRoteiro(marcaA.id, "2026-09-17", { formato: "story", momentoDoDia: "manha" });
    await criarRoteiro(marcaA.id, "2026-09-17", { formato: "story", momentoDoDia: "noite" });
    // Marca B nao pode aparecer na semana de A.
    await criarRoteiro(marcaB.id, "2026-09-15", { formato: "reels" });

    const semana = await semanaDaAgenda(marcaA.id, "2026-09-16");
    const segunda = semana.find((d) => d.data === "2026-09-14")!;
    const terca = semana.find((d) => d.data === "2026-09-15")!;
    const quinta = semana.find((d) => d.data === "2026-09-17")!;

    expect(segunda.marca).toEqual({ qtdReels: 0, qtdStories: 0 });
    expect(terca.marca).toEqual({ qtdReels: 1, qtdStories: 0 });
    expect(quinta.marca).toEqual({ qtdReels: 0, qtdStories: 2 });
  });

  it("o plano e quantos roteiros quiser por dia: dois Reels no mesmo dia contam os dois (revisao do Fable no PR #90)", async () => {
    await criarRoteiro(marcaA.id, "2026-09-18", { formato: "reels", titulo: "primeiro reels do dia" });
    await criarRoteiro(marcaA.id, "2026-09-18", { formato: "reels", titulo: "segundo reels do dia" });

    const semana = await semanaDaAgenda(marcaA.id, "2026-09-16");
    const sexta = semana.find((d) => d.data === "2026-09-18")!;
    expect(sexta.marca).toEqual({ qtdReels: 2, qtdStories: 0 });
  });

  it("o campo hoje e true so no dia de hoje de verdade", async () => {
    const hoje = hojeISO();
    const semana = await semanaDaAgenda(marcaA.id, hoje);
    const diasDeHoje = semana.filter((d) => d.hoje);
    expect(diasDeHoje).toHaveLength(1);
    expect(diasDeHoje[0]!.data).toBe(hoje);
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
});
