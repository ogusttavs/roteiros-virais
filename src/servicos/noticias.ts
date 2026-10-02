/**
 * E43, as Notícias do setor (`estrategia/plano-de-execucao.md`, "E43"): o que a coleta diária por
 * RSS (`jobs/coleta-noticias.ts`) já trouxe e `filtrarNoticias` (dentro de `jobs/temas-do-dia.ts`)
 * já marcou como relevante para o setor, pronto para a pessoa navegar por período e transformar
 * numa ideia de vídeo. A coleta e o filtro não mudam aqui; este arquivo só lê.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/db";
import { noticias, roteiros, type Noticia } from "@/db/schema";

export type PeriodoNoticias = "hoje" | "semana" | "mes";

const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_POR_PERIODO: Record<PeriodoNoticias, number> = { hoje: 1, semana: 7, mes: 30 };

function inicioDoPeriodo(periodo: PeriodoNoticias, agora = new Date()): Date {
  return new Date(agora.getTime() - DIAS_POR_PERIODO[periodo] * DIA_MS);
}

export type NoticiaListada = {
  id: number;
  titulo: string;
  /** "Ler no site" (item 1, cuidado 1 do escopo: nunca a matéria inteira, só o link para o original). */
  url: string;
  fonte: string | null;
  publicadoEm: Date | null;
  resumo: string | null;
  angulo: string | null;
  /** A marca ativa já transformou esta notícia num roteiro (isolado por marca: outra marca do mesmo setor não conta). */
  virouRoteiro: boolean;
  /** O roteiro mais recente desta marca a partir desta notícia; "Ver o roteiro" leva até ele. */
  roteiroId: number | null;
};

/**
 * As notícias relevantes do setor no período, mais recente primeiro, com "virou roteiro" já
 * resolvido para a marca da sessão. `relevante` nulo (ainda não passou por `filtrarNoticias`) ou
 * `false` nunca aparece aqui: a lista é só o que já foi conferido como do interesse do setor.
 */
export async function noticiasDoSetor(
  nichoId: number,
  clienteId: number,
  periodo: PeriodoNoticias,
  agora = new Date(),
): Promise<NoticiaListada[]> {
  const linhas = await db()
    .select()
    .from(noticias)
    .where(and(eq(noticias.nichoId, nichoId), eq(noticias.relevante, true), gte(noticias.publicadoEm, inicioDoPeriodo(periodo, agora))))
    .orderBy(desc(noticias.publicadoEm));

  if (linhas.length === 0) return [];

  const roteirosDaMarca = await db()
    .select({ id: roteiros.id, noticiaId: roteiros.noticiaId, criadoEm: roteiros.criadoEm })
    .from(roteiros)
    .where(and(eq(roteiros.clienteId, clienteId), inArray(roteiros.noticiaId, linhas.map((n) => n.id))))
    .orderBy(desc(roteiros.criadoEm));

  // O primeiro (mais recente) de cada notícia, por causa do orderBy acima.
  const roteiroMaisRecentePorNoticia = new Map<number, number>();
  for (const r of roteirosDaMarca) {
    if (r.noticiaId !== null && !roteiroMaisRecentePorNoticia.has(r.noticiaId)) {
      roteiroMaisRecentePorNoticia.set(r.noticiaId, r.id);
    }
  }

  return linhas.map((n) => ({
    id: n.id,
    titulo: n.titulo,
    url: n.url,
    fonte: n.fonte,
    publicadoEm: n.publicadoEm,
    resumo: n.resumo,
    angulo: n.angulo,
    virouRoteiro: roteiroMaisRecentePorNoticia.has(n.id),
    roteiroId: roteiroMaisRecentePorNoticia.get(n.id) ?? null,
  }));
}

/** Quantas notícias relevantes o setor teve na semana (o estado vazio do dia aponta para esse número). */
export async function contagemNoticiasNaSemana(nichoId: number, agora = new Date()): Promise<number> {
  const linhas = await db()
    .select({ id: noticias.id })
    .from(noticias)
    .where(and(eq(noticias.nichoId, nichoId), eq(noticias.relevante, true), gte(noticias.publicadoEm, inicioDoPeriodo("semana", agora))));
  return linhas.length;
}

/** A notícia aberta (a folha) e o ponto de partida do Tema livre (`comNoticia`); escopada pelo setor da marca. */
export async function noticiaPorId(id: number, nichoId: number): Promise<Noticia | null> {
  const [linha] = await db()
    .select()
    .from(noticias)
    .where(and(eq(noticias.id, id), eq(noticias.nichoId, nichoId)));
  return linha ?? null;
}
