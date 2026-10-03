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
import { config } from "@/lib/config";
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
  /** E45 PR 3: o setor do vídeo, para a regra por setor (o principal ou um ramo alternativo da marca). */
  nichoId?: number | null;
};

/** E45 PR 3: a janela e a proporção do Brasil do setor de um vídeo (cada ramo da conta tem a sua régua). */
export type RegraDoSetor = { janelaDias: number; proporcaoBrasil: number };

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
 *
 * Hotfix de 02/10/2026 (achado de produção: Overtake e o perfil do Bruno fecharam o dia sem tema
 * novo, com 74 e 47 candidatos na base): a parte brasileira da prova segue a régua do setor
 * (`nichos.proporcao_brasil`, M3). Passa com maioria brasileira, como sempre, **ou** quando os
 * brasileiros alcançam a proporção que o Gustavo definiu para aquele setor (a Overtake está em
 * 30%: 1 brasileiro em 3 basta). No padrão do produto (70%) a maioria continua sendo a regra que
 * decide, então nada muda para os setores sem régua própria.
 */
export function temaTemProvaSuficiente(
  idsEvidenciaVideo: number[],
  videosPorId: Map<number, VideoParaProva>,
  agora: Date,
  janelaDias: number,
  proporcaoBrasil: number = config.regras.proporcaoBrasil,
  regrasPorSetor?: Map<number, RegraDoSetor>,
): boolean {
  return motivoSemProva(idsEvidenciaVideo, videosPorId, agora, janelaDias, proporcaoBrasil, regrasPorSetor) === null;
}

/** Quantos brasileiros a prova pede entre `total` vídeos, pela régua do setor (nunca mais que a maioria simples). */
export function minimoBrasileirosNaProva(total: number, proporcaoBrasil: number): number {
  const pelaMaioria = Math.floor(total / 2) + 1;
  const pelaRegua = Math.ceil(total * proporcaoBrasil - 1e-9);
  return Math.max(0, Math.min(pelaMaioria, pelaRegua));
}

/**
 * `null` quando a prova basta; senão, a razão em uma frase, que volta para o modelo na segunda
 * tentativa do `temas-do-dia` (o gerador precisa saber por que o tema dele foi barrado).
 */
export function motivoSemProva(
  idsEvidenciaVideo: number[],
  videosPorId: Map<number, VideoParaProva>,
  agora: Date,
  janelaDias: number,
  proporcaoBrasil: number = config.regras.proporcaoBrasil,
  /**
   * E45 PR 3: com ramos alternativos, a janela de cada vídeo é a do setor dele (como o piso, decisão 48), e a proporção do Brasil é a média das proporções
   * dos setores ponderada pelo número de vídeos de cada um (o mínimo continua calculado sobre o total). Sem isto (ou para um setor que não está no mapa), vale o par `janelaDias`/`proporcaoBrasil`.
   */
  regrasPorSetor?: Map<number, RegraDoSetor>,
): string | null {
  const regraDe = (v: VideoParaProva): RegraDoSetor =>
    (v.nichoId != null ? regrasPorSetor?.get(v.nichoId) : undefined) ?? { janelaDias, proporcaoBrasil };
  const naJanela = idsEvidenciaVideo
    .map((id) => videosPorId.get(id))
    .filter(
      (v): v is VideoParaProva =>
        v !== undefined &&
        v.publicadoEm !== null &&
        v.publicadoEm >= new Date(agora.getTime() - regraDe(v).janelaDias * DIA_MS),
    );

  if (naJanela.length < MINIMO_VIDEOS_PROVA) {
    return `citou ${naJanela.length} vídeo(s) válidos, precisa de pelo menos ${MINIMO_VIDEOS_PROVA}`;
  }

  const contasDistintas = new Set(naJanela.filter((v) => v.contaId !== null).map((v) => v.contaId));
  if (contasDistintas.size < MINIMO_CONTAS_PROVA) {
    return `os vídeos citados são de ${contasDistintas.size} conta(s), precisa de pelo menos ${MINIMO_CONTAS_PROVA} contas diferentes`;
  }

  const brasileiros = naJanela.filter(
    (v) => classificarBrasil(v.idioma, contaEhBrasileira(v.contaPais, v.contaIdiomaPrincipal)) === "brasileiro",
  ).length;
  // Com regras por setor (E45 PR 3, item 0a da E48): o mínimo é calculado sobre o TOTAL de vídeos citados, com a proporção ponderada pelo número de
  // vídeos de cada setor (sum(n_setor * p_setor) / n_total), e o teto "maioria simples" sobre o total, como sempre. Sem as regras (os temas do dia),
  // a proporção é a recebida, como antes.
  const proporcaoDaProva = regrasPorSetor
    ? naJanela.reduce((soma, v) => soma + regraDe(v).proporcaoBrasil, 0) / naJanela.length
    : proporcaoBrasil;
  const minimo = minimoBrasileirosNaProva(naJanela.length, proporcaoDaProva);
  if (brasileiros < minimo) {
    return `só ${brasileiros} de ${naJanela.length} vídeos citados são do Brasil, precisa de pelo menos ${minimo}`;
  }
  return null;
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
      nichoId: videos.nichoId,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(inArray(videos.id, idsVideo));

  return new Map(linhas.map((l) => [l.id, l]));
}
