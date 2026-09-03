/**
 * Consultas prontas sobre o que o job `pontuar` calculou (etapa 7, decisão 6
 * do `PROXIMO.md`): o que está fora da curva no nicho, e o que está subindo
 * hoje. São as consultas que as etapas 8, 9 e 10 vão usar para escolher o
 * que transcrever, extrair e citar como evidência no tema e no roteiro; por
 * enquanto também alimentam `/admin/nichos/[slug]`.
 *
 * Fora de desenvolvimento, vídeo de seed nunca aparece (regra do
 * `plataforma/CLAUDE.md`: "toda consulta de produto filtra origem <> seed
 * fora de desenvolvimento"). As duas ordenam de forma determinística
 * (desempate por id), para a mesma consulta não devolver ordens diferentes
 * em execuções iguais.
 */
import { and, asc, desc, eq, gte, isNotNull, lte, ne } from "drizzle-orm";

import { db } from "@/db";
import { contas, videos, type Plataforma } from "@/db/schema";

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

export type VideoRankeado = {
  id: number;
  plataforma: Plataforma;
  url: string;
  titulo: string | null;
  contaHandle: string | null;
  views: number;
  foraDaCurva: number | null;
  velocidade: number | null;
  velocidadeRelativa: number | null;
  publicadoEm: Date | null;
};

function incluirSeed(): boolean {
  return process.env.NODE_ENV === "development";
}

function mapear(linha: {
  id: number;
  plataforma: Plataforma;
  url: string;
  titulo: string | null;
  contaHandle: string | null;
  views: number;
  foraDaCurva: string | null;
  velocidade: string | null;
  velocidadeRelativa: string | null;
  publicadoEm: Date | null;
}): VideoRankeado {
  return {
    ...linha,
    foraDaCurva: linha.foraDaCurva === null ? null : Number(linha.foraDaCurva),
    velocidade: linha.velocidade === null ? null : Number(linha.velocidade),
    velocidadeRelativa: linha.velocidadeRelativa === null ? null : Number(linha.velocidadeRelativa),
  };
}

const COLUNAS = {
  id: videos.id,
  plataforma: videos.plataforma,
  url: videos.url,
  titulo: videos.titulo,
  contaHandle: contas.handle,
  views: videos.views,
  foraDaCurva: videos.foraDaCurva,
  velocidade: videos.velocidade,
  velocidadeRelativa: videos.velocidadeRelativa,
  publicadoEm: videos.publicadoEm,
};

/** O que está fora da curva no nicho nos últimos `dias` dias (escopo 5.1). */
export async function foraDaCurvaDoNicho(
  nichoId: number,
  dias = 90,
  limite?: number,
): Promise<VideoRankeado[]> {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, diasAtras(dias)),
    isNotNull(videos.foraDaCurva),
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const consulta = db()
    .select(COLUNAS)
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(...condicoes))
    .orderBy(desc(videos.foraDaCurva), asc(videos.id));

  const linhas = limite ? await consulta.limit(limite) : await consulta;
  return linhas.map(mapear);
}

/** O que está subindo hoje no nicho: 2 a 7 dias, por velocidade relativa (escopo 5.1). */
export async function subindoHoje(nichoId: number, limite?: number): Promise<VideoRankeado[]> {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    lte(videos.publicadoEm, diasAtras(2)),
    gte(videos.publicadoEm, diasAtras(7)),
    isNotNull(videos.velocidadeRelativa),
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const consulta = db()
    .select(COLUNAS)
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(...condicoes))
    .orderBy(desc(videos.velocidadeRelativa), asc(videos.id));

  const linhas = limite ? await consulta.limit(limite) : await consulta;
  return linhas.map(mapear);
}
