import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { usdParaBrl } from "@/config/dinheiro";
import { rotuloDoMotivo } from "@/config/motivos-reprovacao";
import { ramoPorSlug } from "@/config/ramos";
import { db } from "@/db";
import { briefings, clientes, execucoesJob, geracoesIA, nichos, roteiros, temasDia, videos } from "@/db/schema";
import { FILAS } from "@/jobs/fila";
import { hojeISO } from "@/lib/config";
import { estadoPorDia, NOMES_JOB_COLETA, type EstadoAgregado } from "@/servicos/admin-acompanhamento";
import { listarContasAdmin } from "@/servicos/admin-contas";
import { fixoMensalEmReais, tetoDiarioEmReais } from "@/servicos/admin-custos";
import { contarPedidosAbertos } from "@/servicos/pedidos-de-ramo";

const FUSO = "America/Sao_Paulo";
const DIA_MS = 24 * 60 * 60 * 1000;

/** Um ramo (setor ativo) na tabela "A madrugada": o que cada passo fez hoje e o que deu errado. */
export type LinhaDaMadrugada = {
  nichoId: number;
  nome: string;
  busca: { novos: number };
  transcricao: { transcritos: number };
  analise: { analisados: number };
  temas: { quantos: number; tentou: boolean; /** Sem tema depois da hora em que ele já devia existir. */ atrasado: boolean };
  /** Tem algo a olhar: um passo em erro, ou nenhum tema depois do horário em que ele já devia existir. */
  comProblema: boolean;
};

/** O estado de hoje das rotinas que são de todos os ramos de uma vez (a busca junta sete jobs globais; a transcrição é uma só): mostrado uma vez, fora da tabela por ramo. */
export type RotinasDoDia = { busca: EstadoAgregado; transcricao: EstadoAgregado; erroDaBusca: string | null; erroDaTranscricao: string | null };

export type ErroRecente = { id: number; nome: string; quando: Date; mensagem: string; continua: boolean };

export type InicioAdmin = {
  agora: Date;
  madrugada: { totalDeRamos: number; ok: number; linhas: LinhaDaMadrugada[]; comProblema: LinhaDaMadrugada[]; rotinas: RotinasDoDia };
  erros: { hoje: number; recentes: ErroRecente[] };
  dinheiro: { saiuHojeUsd: number; saiu30dUsd: number; saiu30dComFixosBrl: number; fixosBrl: number; fixosCadastrados: number; tetoBrl: number; passouDoTeto: boolean };
  contas: { ativas: number; usaramOntem: number; pararam: number; briefingIncompleto: number; novasNaSemana: number };
  produto: { escritos: number; gravados: number; postados: number; reprovados: number; motivoMaisComum: { rotulo: string; vezes: number } | null };
  atencao: { pedidosDeRamo: number };
};

/** Depois desta hora (Brasil) um ramo sem tema do dia já é problema; antes, a madrugada ainda pode estar rodando. */
export const HORA_EM_QUE_O_TEMA_JA_DEVIA_EXISTIR = 8;

export function horaNoBrasil(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: FUSO }).format(d)) % 24;
}

/** A regra do "com problema", pura para provar sem banco. */
export function ramoComProblema(linha: Omit<LinhaDaMadrugada, "comProblema">): boolean {
  return linha.temas.atrasado;
}

function inicioDoDia(hoje: string): Date {
  return new Date(`${hoje}T00:00:00-03:00`);
}

async function madrugada(agora: Date): Promise<InicioAdmin["madrugada"]> {
  const hoje = hojeISO(agora);
  const desde = inicioDoDia(hoje);
  const ramos = await db().select({ id: nichos.id, nome: nichos.nome, ramoCatalogo: nichos.ramoCatalogo }).from(nichos).where(eq(nichos.ativo, true)).orderBy(nichos.nome);
  if (ramos.length === 0) return { totalDeRamos: 0, ok: 0, linhas: [], comProblema: [], rotinas: { busca: "sem_execucao", transcricao: "sem_execucao", erroDaBusca: null, erroDaTranscricao: null } };
  const ids = ramos.map((r) => r.id);

  const [coletaDoDia, transcreverDoDia, novos, transcritos, analisados, temas] = await Promise.all([
    estadoPorDia(NOMES_JOB_COLETA, hoje),
    estadoPorDia([FILAS.transcrever], hoje),
    db().select({ nichoId: videos.nichoId, total: count() }).from(videos).where(and(inArray(videos.nichoId, ids), gte(videos.coletadoEm, desde))).groupBy(videos.nichoId),
    db().select({ nichoId: videos.nichoId, total: count() }).from(videos).where(and(inArray(videos.nichoId, ids), gte(videos.transcritoEm, desde))).groupBy(videos.nichoId),
    db().select({ nichoId: videos.nichoId, total: count() }).from(videos).where(and(inArray(videos.nichoId, ids), gte(videos.analiseVisualEm, desde))).groupBy(videos.nichoId),
    db().select({ nichoId: temasDia.nichoId, temas: temasDia.temas }).from(temasDia).where(and(inArray(temasDia.nichoId, ids), eq(temasDia.data, hoje))),
  ]);
  const por = (linhas: { nichoId: number | null; total: number }[]) => new Map(linhas.map((l) => [l.nichoId, l.total]));
  const novosPor = por(novos);
  const transcritosPor = por(transcritos);
  const analisadosPor = por(analisados);
  const rotinas: RotinasDoDia = {
    busca: coletaDoDia.get(hoje)?.estado ?? "sem_execucao",
    transcricao: transcreverDoDia.get(hoje)?.estado ?? "sem_execucao",
    erroDaBusca: coletaDoDia.get(hoje)?.erro ?? null,
    erroDaTranscricao: transcreverDoDia.get(hoje)?.erro ?? null,
  };

  const linhas = ramos.map((r) => {
    const tema = temas.find((t) => t.nichoId === r.id);
    const base = {
      nichoId: r.id,
      nome: ramoPorSlug(r.ramoCatalogo)?.nome ?? r.nome,
      busca: { novos: novosPor.get(r.id) ?? 0 },
      transcricao: { transcritos: transcritosPor.get(r.id) ?? 0 },
      analise: { analisados: analisadosPor.get(r.id) ?? 0 },
      temas: { quantos: tema?.temas.length ?? 0, tentou: Boolean(tema), atrasado: (tema?.temas.length ?? 0) === 0 && horaNoBrasil(agora) >= HORA_EM_QUE_O_TEMA_JA_DEVIA_EXISTIR },
    };
    return { ...base, comProblema: ramoComProblema(base) };
  });
  const comProblema = linhas.filter((l) => l.comProblema);
  return { totalDeRamos: linhas.length, ok: linhas.length - comProblema.length, linhas, comProblema, rotinas };
}

async function erros(agora: Date): Promise<InicioAdmin["erros"]> {
  const desde = inicioDoDia(hojeISO(agora));
  const [recentes, [hoje]] = await Promise.all([
    db()
      .select({ id: execucoesJob.id, nome: execucoesJob.nome, iniciadoEm: execucoesJob.iniciadoEm, terminadoEm: execucoesJob.terminadoEm, erro: execucoesJob.erro })
      .from(execucoesJob)
      .where(eq(execucoesJob.status, "erro"))
      .orderBy(desc(execucoesJob.id))
      .limit(5),
    db().select({ total: count() }).from(execucoesJob).where(and(eq(execucoesJob.status, "erro"), gte(execucoesJob.iniciadoEm, desde))),
  ]);
  if (recentes.length === 0) return { hoje: hoje?.total ?? 0, recentes: [] };
  // "Continua": o mesmo job não rodou ok depois daquele erro. "Resolvido": rodou.
  const nomes = [...new Set(recentes.map((r) => r.nome))];
  const oks = await db()
    .select({ nome: execucoesJob.nome, ultimo: sql<number>`max(${execucoesJob.id})` })
    .from(execucoesJob)
    .where(and(inArray(execucoesJob.nome, nomes), eq(execucoesJob.status, "ok")))
    .groupBy(execucoesJob.nome);
  const ultimoOk = new Map(oks.map((o) => [o.nome, o.ultimo]));
  return {
    hoje: hoje?.total ?? 0,
    recentes: recentes.map((r) => ({
      id: r.id,
      nome: r.nome,
      quando: r.terminadoEm ?? r.iniciadoEm,
      mensagem: r.erro ?? "",
      continua: (ultimoOk.get(r.nome) ?? 0) < r.id,
    })),
  };
}

async function dinheiro(agora: Date): Promise<InicioAdmin["dinheiro"]> {
  const inicio = inicioDoDia(hojeISO(agora));
  const [[hoje], [mes]] = await Promise.all([
    db().select({ total: sql<string>`coalesce(sum(${geracoesIA.custoUsd}), 0)` }).from(geracoesIA).where(gte(geracoesIA.criadoEm, inicio)),
    db().select({ total: sql<string>`coalesce(sum(${geracoesIA.custoUsd}), 0)` }).from(geracoesIA).where(gte(geracoesIA.criadoEm, new Date(agora.getTime() - 30 * DIA_MS))),
  ]);
  const saiuHojeUsd = Number(hoje?.total ?? 0);
  const saiu30dUsd = Number(mes?.total ?? 0);
  const [fixos, tetoBrl] = await Promise.all([fixoMensalEmReais(), tetoDiarioEmReais()]);
  return { saiuHojeUsd, saiu30dUsd, saiu30dComFixosBrl: usdParaBrl(saiu30dUsd) + fixos.total, fixosBrl: fixos.total, fixosCadastrados: fixos.cadastrados, tetoBrl, passouDoTeto: usdParaBrl(saiuHojeUsd) > tetoBrl };
}

async function produto(agora: Date): Promise<InicioAdmin["produto"]> {
  const desde = hojeISO(new Date(agora.getTime() - 6 * DIA_MS));
  const [linha] = await db()
    .select({
      escritos: count(),
      gravados: sql<number>`count(*) filter (where ${roteiros.status} in ('gravado','postado'))::int`,
      postados: sql<number>`count(*) filter (where ${roteiros.status} = 'postado')::int`,
    })
    .from(roteiros)
    .where(gte(roteiros.data, desde));
  const reprovadas = await db()
    .select({ motivos: geracoesIA.motivosAvaliacao })
    .from(geracoesIA)
    .where(and(eq(geracoesIA.avaliacao, "reprovado"), gte(geracoesIA.criadoEm, new Date(agora.getTime() - 7 * DIA_MS))));
  const contagem = new Map<string, number>();
  for (const r of reprovadas) for (const m of r.motivos ?? []) contagem.set(m, (contagem.get(m) ?? 0) + 1);
  const [primeiro] = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
  return {
    escritos: linha?.escritos ?? 0,
    gravados: linha?.gravados ?? 0,
    postados: linha?.postados ?? 0,
    reprovados: reprovadas.length,
    motivoMaisComum: primeiro ? { rotulo: rotuloDoMotivo(primeiro[0]), vezes: primeiro[1] } : null,
  };
}

async function contas(agora: Date): Promise<InicioAdmin["contas"]> {
  const todas = (await listarContasAdmin(agora)).filter((c) => c.ativo);
  const ontem = hojeISO(new Date(agora.getTime() - DIA_MS));
  const semana = new Date(agora.getTime() - 7 * DIA_MS);
  const [completos, [novas]] = await Promise.all([
    db().select({ clienteId: briefings.clienteId }).from(briefings).where(eq(briefings.completo, true)),
    db().select({ total: count() }).from(clientes).where(and(eq(clientes.ativo, true), gte(clientes.criadoEm, semana))),
  ]);
  const comBriefingCompleto = new Set(completos.map((b) => b.clienteId));
  return {
    ativas: todas.length,
    usaramOntem: todas.filter((c) => c.ultimos7.some((d) => d.dia === ontem && d.estado !== "nada")).length,
    pararam: todas.filter((c) => c.parou).length,
    briefingIncompleto: todas.filter((c) => !comBriefingCompleto.has(c.id)).length,
    novasNaSemana: novas?.total ?? 0,
  };
}

/** Tudo o que o Início do admin mostra (E46 PR 1), de uma vez. */
export async function inicioDoAdmin(agora: Date = new Date()): Promise<InicioAdmin> {
  const [m, e, d, c, p, pedidos] = await Promise.all([madrugada(agora), erros(agora), dinheiro(agora), contas(agora), produto(agora), contarPedidosAbertos()]);
  return { agora, madrugada: m, erros: e, dinheiro: d, contas: c, produto: p, atencao: { pedidosDeRamo: pedidos } };
}
