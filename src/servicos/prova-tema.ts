/**
 * Prova mínima para um tema ter evidência de verdade (V2b, item 8, escopo
 * 5.12, passo 6): pelo menos `MINIMO_VIDEOS_PROVA` vídeos analisados dentro
 * da janela, de pelo menos `MINIMO_CONTAS_PROVA` contas diferentes, com
 * maioria brasileira. Extraído de `jobs/temas-do-dia.ts` (V5b, item 4): o
 * ângulo sugerido do tema livre usa a mesma régua para decidir se aparece.
 */
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { contas, videos } from "@/db/schema";
import { classificarBrasil, contaEhBrasileira } from "@/servicos/proporcao-brasil";

export const MINIMO_VIDEOS_PROVA = 3;
export const MINIMO_CONTAS_PROVA = 2;
/** Janela padrão da prova; nicho com menos de 7 dias de base usa `JANELA_PROVA_NICHO_NOVO_DIAS`. */
export const JANELA_PROVA_DIAS = 7;
/** Nicho novo tem menos evidência acumulada; dobra a janela para ter chance de juntar prova de verdade. */
export const JANELA_PROVA_NICHO_NOVO_DIAS = 14;

const DIA_MS = 24 * 60 * 60 * 1000;

export type VideoParaProva = {
  id: number;
  contaId: number | null;
  publicadoEm: Date | null;
  idioma: string | null;
  contaPais: string | null;
  contaIdiomaPrincipal: string | null;
};

/** Janela de dias da prova (V2b, item 8): dobra para nicho com menos de `JANELA_PROVA_DIAS` dias de base. */
export function janelaDeProva(nichoCriadoEm: Date, agora: Date): number {
  const diasDeBase = (agora.getTime() - nichoCriadoEm.getTime()) / DIA_MS;
  return diasDeBase < JANELA_PROVA_DIAS ? JANELA_PROVA_NICHO_NOVO_DIAS : JANELA_PROVA_DIAS;
}

/**
 * Função pura, testável sem banco: pelo menos `MINIMO_VIDEOS_PROVA` vídeos
 * citados dentro da janela, de pelo menos `MINIMO_CONTAS_PROVA` contas
 * diferentes (vídeo sem dono, `contaId` nulo, nunca conta para "contas
 * diferentes", só para a contagem de vídeos), com maioria brasileira entre
 * os vídeos da janela.
 */
export function temaTemProvaSuficiente(
  idsEvidenciaVideo: number[],
  videosPorId: Map<number, VideoParaProva>,
  agora: Date,
  janelaDias: number,
): boolean {
  const desde = new Date(agora.getTime() - janelaDias * DIA_MS);
  const naJanela = idsEvidenciaVideo
    .map((id) => videosPorId.get(id))
    .filter((v): v is VideoParaProva => v !== undefined && v.publicadoEm !== null && v.publicadoEm >= desde);

  if (naJanela.length < MINIMO_VIDEOS_PROVA) return false;

  const contasDistintas = new Set(naJanela.filter((v) => v.contaId !== null).map((v) => v.contaId));
  if (contasDistintas.size < MINIMO_CONTAS_PROVA) return false;

  const brasileiros = naJanela.filter(
    (v) => classificarBrasil(v.idioma, contaEhBrasileira(v.contaPais, v.contaIdiomaPrincipal)) === "brasileiro",
  ).length;
  return brasileiros > naJanela.length / 2;
}

/** Busca os campos de `temaTemProvaSuficiente` para uma lista de ids de vídeo, numa consulta só. */
export async function buscarVideosParaProva(idsVideo: number[]): Promise<Map<number, VideoParaProva>> {
  if (idsVideo.length === 0) return new Map();

  const linhas = await db()
    .select({
      id: videos.id,
      contaId: videos.contaId,
      publicadoEm: videos.publicadoEm,
      idioma: videos.idioma,
      contaPais: contas.pais,
      contaIdiomaPrincipal: contas.idiomaPrincipal,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(inArray(videos.id, idsVideo));

  return new Map(linhas.map((l) => [l.id, l]));
}
