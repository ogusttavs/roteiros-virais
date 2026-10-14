/**
 * E52 (PR 4c): os vídeos longos do YouTube nas Referências, com a pílula "Duração" ligada em "Mais de 3 min". A lista é a de `longosDoSetor` (os longos do ramo acima do piso de views dele,
 * os mais fora da curva primeiro), enriquecida com o que o cartão precisa (a capa, a conta e a mediana dela, a leitura da estrutura) e filtrada pelos filtros de hoje que valem para um vídeo
 * longo: a busca, as views mínimas, "Brasil ou fora" e a ordem. Os que só existem na análise dos curtos (tipo de vídeo, fala, "parece feito para") não valem aqui: o longo não passa por
 * essa análise. O longo é sempre YouTube.
 */
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { contas, videos, type MedianaOrigem } from "@/db/schema";
import { capituloQueInteressa, type CapituloQueInteressa } from "@/lib/capitulo-de-referencia";

import type { OrdemReferencias } from "./pesquisa";
import { longosDoSetor, type VideoLongoDoSetor } from "./videos-longos";

/** Quantos capítulos da descrição o cartão mostra (os outros ficam na descrição do próprio vídeo). */
export const CAPITULOS_NO_CARTAO = 5;
/** O teto da lista: o ramo raramente tem tantos longos acima do piso em 30 dias, e a tela não pagina. */
export const LIMITE_DOS_LONGOS = 60;

export type LongoParaATela = {
  id: number;
  nichoId: number | null;
  url: string;
  titulo: string | null;
  views: number;
  duracaoS: number;
  publicadoEm: Date | null;
  foraDaCurva: number;
  contaNome: string | null;
  contaHandle: string | null;
  contaMedianaOrigem: MedianaOrigem | null;
  medianaConta: number | null;
  capaUrl: string | null;
  /** Os capítulos que o dono escreveu na descrição (até `CAPITULOS_NO_CARTAO`), com o tempo. */
  capitulos: { inicioS: number; titulo: string }[];
  /** Quantos capítulos a descrição tem ao todo (o cartão diz "e mais N" quando passa do que mostra). */
  totalDeCapitulos: number;
  /** "O capítulo que interessa", só quando a leitura da estrutura existe e a abertura entrega; nulo nos outros (o cartão diz "Ver desde o começo"). */
  capituloQueInteressa: CapituloQueInteressa | null;
  /** O que a leitura da estrutura diz, para a folha de detalhes (vazio quando o vídeo ainda não foi lido). */
  leitura: { gancho: string; estrutura: string; porQueFuncionou: string } | null;
  brasileiro: boolean;
};

export type FiltrosDosLongos = {
  nichoIds: number[];
  /** A janela em dias (30 por padrão); a tela manda o maior entre o período escolhido e os 30 do longo. */
  dias?: number;
  busca?: string;
  viewsMin?: number;
  /** `true` só os do Brasil, `false` só os de fora, nulo os dois. */
  brasil?: boolean;
  ordem?: OrdemReferencias;
  /** Só estes vídeos (a aba "Salvos"). */
  apenasIds?: number[];
  agora?: Date;
};

const SEM_ACENTO = /[̀-ͯ]/g;
function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(SEM_ACENTO, "").toLowerCase();
}

/** Ordena como a tela pede; "views por hora" não existe para o longo (a medida só vale para o curto nos primeiros dias), então cai nas views. */
export function ordenarLongos<T extends { views: number; foraDaCurva: number; publicadoEm: Date | null; id: number }>(lista: T[], ordem: OrdemReferencias | undefined): T[] {
  const copia = [...lista];
  const dataDe = (v: T) => v.publicadoEm?.getTime() ?? 0;
  if (ordem === "recentes") copia.sort((a, b) => dataDe(b) - dataDe(a) || b.views - a.views || a.id - b.id);
  else if (ordem === "views" || ordem === "velocidade") copia.sort((a, b) => b.views - a.views || b.foraDaCurva - a.foraDaCurva || a.id - b.id);
  else copia.sort((a, b) => b.foraDaCurva - a.foraDaCurva || b.views - a.views || a.id - b.id);
  return copia;
}

/** A lista de longos que a tela mostra, já filtrada e ordenada. O total é o da lista inteira (antes do teto). */
export async function longosParaAsReferencias(filtros: FiltrosDosLongos): Promise<{ videos: LongoParaATela[]; total: number }> {
  const brutos: VideoLongoDoSetor[] = (await Promise.all(filtros.nichoIds.map((id) => longosDoSetor(id, { dias: filtros.dias, agora: filtros.agora })))).flat();
  const permitidos = filtros.apenasIds ? new Set(filtros.apenasIds) : null;
  const candidatos = permitidos ? brutos.filter((v) => permitidos.has(v.id)) : brutos;
  if (candidatos.length === 0) return { videos: [], total: 0 };

  const extras = await db()
    .select({
      id: videos.id,
      nichoId: videos.nichoId,
      capaUrl: videos.capaUrl,
      analiseLonga: videos.analiseLonga,
      contaNome: contas.nome,
      contaHandle: contas.handle,
      contaMedianaOrigem: contas.medianaOrigem,
      medianaConta: contas.medianaViews,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(
      inArray(
        videos.id,
        candidatos.map((v) => v.id),
      ),
    );
  const extraPorId = new Map(extras.map((e) => [e.id, e]));

  let lista: LongoParaATela[] = candidatos.map((v) => {
    const e = extraPorId.get(v.id);
    const analise = e?.analiseLonga ?? null;
    return {
      id: v.id,
      nichoId: e?.nichoId ?? null,
      url: v.url,
      titulo: v.titulo,
      views: v.views,
      duracaoS: v.duracaoS,
      publicadoEm: v.publicadoEm,
      foraDaCurva: v.foraDaCurva ?? 0,
      contaNome: e?.contaNome ?? null,
      contaHandle: e?.contaHandle ?? null,
      contaMedianaOrigem: e?.contaMedianaOrigem ?? null,
      medianaConta: e?.medianaConta === null || e?.medianaConta === undefined ? null : Number(e.medianaConta),
      capaUrl: e?.capaUrl ?? null,
      capitulos: v.capitulos.slice(0, CAPITULOS_NO_CARTAO),
      totalDeCapitulos: v.capitulos.length,
      capituloQueInteressa: capituloQueInteressa(analise, v.duracaoS),
      leitura: analise
        ? {
            gancho: analise.abertura?.promessa ?? "",
            estrutura: (analise.capitulos ?? []).map((c) => c.nome).join(", "),
            porQueFuncionou: analise.porQueFuncionou ?? "",
          }
        : null,
      brasileiro: v.classificacao === "brasileiro",
    };
  });

  if (filtros.viewsMin !== undefined) lista = lista.filter((v) => v.views >= filtros.viewsMin!);
  if (filtros.brasil !== undefined) lista = lista.filter((v) => v.brasileiro === filtros.brasil);
  const busca = semAcento((filtros.busca ?? "").trim());
  if (busca) lista = lista.filter((v) => semAcento(`${v.titulo ?? ""} ${v.contaNome ?? ""}`).includes(busca));

  const ordenada = ordenarLongos(lista, filtros.ordem);
  return { videos: ordenada.slice(0, LIMITE_DOS_LONGOS), total: ordenada.length };
}

/** Quantos longos o ramo tem agora (sem filtro nenhum): decide se a opção "Mais de 3 min" abre ou fica apagada com a frase calma. */
export async function quantosLongosTemOsRamos(nichoIds: number[], dias?: number): Promise<number> {
  const listas = await Promise.all(nichoIds.map((id) => longosDoSetor(id, { dias })));
  return listas.reduce((soma, l) => soma + l.length, 0);
}
