/**
 * E52 (PR 2), o custo dos vídeos longos, para a aba Custos: o que a rotina `ler-longos` gastou nos últimos 30 dias (com hoje), por ramo. Três gastos, todos já gravados com o ramo e
 * a execução: a transcrição pela Groq e o tráfego do proxy (`custos_externos`, das execuções dessa rotina) e a leitura pela IA (`geracoes_ia`, tarefa `extrairVideoLongo`). Tudo isto
 * já está somado nas outras contas da aba (por ramo, fora da IA, por onde o dinheiro vai); aqui só aparece separado, para a prova com a chave ter onde olhar o que o longo custa.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { custosExternos, execucoesJob, geracoesIA, nichos, videos } from "@/db/schema";
import { FILAS } from "@/jobs/fila";
import { hojeISO } from "@/lib/config";

const DIA_MS = 24 * 60 * 60 * 1000;

export type LinhaDeLongosPorRamo = { ramoId: number | null; nome: string; lidos: number; minutos: number; usd: number };

export type CustosDosLongos = {
  desde: Date;
  /** Quantas vezes a rotina rodou na janela. */
  execucoes: number;
  /** Longos que ganharam a leitura da estrutura na janela. */
  lidos: number;
  /** Minutos de áudio transcritos pela Groq (a legenda do YouTube não entra: é de graça). */
  minutos: number;
  groqUsd: number;
  proxyMb: number;
  proxyUsd: number;
  iaUsd: number;
  chamadasDeIA: number;
  totalUsd: number;
  porRamo: LinhaDeLongosPorRamo[];
};

/** O início do dia de hoje no Brasil (UTC-3 fixo, sem horário de verão), como o resto da aba. */
function inicioDeHoje(agora: Date): Date {
  return new Date(`${hojeISO(agora)}T00:00:00-03:00`);
}

export async function custosDosLongos(agora: Date = new Date()): Promise<CustosDosLongos> {
  const desde = new Date(inicioDeHoje(agora).getTime() - 30 * DIA_MS);

  const execucoes = await db()
    .select({ id: execucoesJob.id })
    .from(execucoesJob)
    .where(and(eq(execucoesJob.nome, FILAS.lerLongos), gte(execucoesJob.iniciadoEm, desde)));
  const idsDasExecucoes = execucoes.map((e) => e.id);

  const externos =
    idsDasExecucoes.length === 0
      ? []
      : await db()
          .select({
            ramoId: custosExternos.ramoId,
            fonte: custosExternos.fonte,
            usd: sql<string>`coalesce(sum(${custosExternos.custoUsd}), 0)`,
            unidades: sql<string>`coalesce(sum(${custosExternos.unidades}), 0)`,
          })
          .from(custosExternos)
          .where(and(inArray(custosExternos.execucaoId, idsDasExecucoes), gte(custosExternos.criadoEm, desde)))
          .groupBy(custosExternos.ramoId, custosExternos.fonte);

  const ia = await db()
    .select({ ramoId: geracoesIA.ramoId, usd: sql<string>`coalesce(sum(${geracoesIA.custoUsd}), 0)`, n: sql<number>`count(*)::int` })
    .from(geracoesIA)
    .where(and(eq(geracoesIA.tarefa, "extrairVideoLongo"), gte(geracoesIA.criadoEm, desde)))
    .groupBy(geracoesIA.ramoId);

  const lidosPorRamo = await db()
    .select({ ramoId: videos.nichoId, n: sql<number>`count(*)::int` })
    .from(videos)
    .where(gte(videos.analiseLongaEm, desde))
    .groupBy(videos.nichoId);

  const total = { lidos: 0, minutos: 0, groqUsd: 0, proxyMb: 0, proxyUsd: 0, iaUsd: 0, chamadasDeIA: 0 };
  const porRamo = new Map<number | null, { lidos: number; minutos: number; usd: number }>();
  const ramo = (id: number | null) => {
    let linha = porRamo.get(id);
    if (!linha) {
      linha = { lidos: 0, minutos: 0, usd: 0 };
      porRamo.set(id, linha);
    }
    return linha;
  };

  for (const e of externos) {
    const usd = Number(e.usd);
    const unidades = Number(e.unidades);
    const linha = ramo(e.ramoId);
    linha.usd += usd;
    if (e.fonte === "groq") {
      total.groqUsd += usd;
      total.minutos += unidades;
      linha.minutos += unidades;
    } else if (e.fonte === "proxy") {
      total.proxyUsd += usd;
      total.proxyMb += unidades;
    }
  }
  for (const g of ia) {
    const usd = Number(g.usd);
    total.iaUsd += usd;
    total.chamadasDeIA += g.n;
    ramo(g.ramoId).usd += usd;
  }
  for (const l of lidosPorRamo) {
    total.lidos += l.n;
    ramo(l.ramoId).lidos += l.n;
  }

  const ids = [...porRamo.keys()].filter((id): id is number => id !== null);
  const nomes = new Map<number, string>();
  if (ids.length > 0) {
    for (const n of await db().select({ id: nichos.id, nome: nichos.nome }).from(nichos).where(inArray(nichos.id, ids))) nomes.set(n.id, n.nome);
  }

  return {
    desde,
    execucoes: execucoes.length,
    ...total,
    totalUsd: total.groqUsd + total.proxyUsd + total.iaUsd,
    porRamo: [...porRamo.entries()]
      .map(([ramoId, l]) => ({ ramoId, nome: ramoId === null ? "sem ramo" : (nomes.get(ramoId) ?? `ramo ${ramoId}`), ...l }))
      .sort((a, b) => b.usd - a.usd || a.nome.localeCompare(b.nome, "pt-BR")),
  };
}
