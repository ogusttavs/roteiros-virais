/**
 * O nível conta do aprendizado (E16, parte 1): o que funcionou para a PRÓPRIA marca, lido dos
 * vídeos que ela postou e que a curva (`curva.ts`) já mediu. A reprovação com motivo
 * (`aprendizado.ts`) diz o que a pessoa não quer; isto diz o que o público dela respondeu.
 *
 * Tudo por código, sem IA, e tudo de uma marca só: cada consulta filtra pelo `clienteId` e exige
 * que o roteiro seja da mesma marca do vídeo. O texto que sai leva rótulo e número, nunca tema,
 * gancho ou frase de roteiro (circula padrão, nunca conteúdo); e nada de outra marca entra,
 * nem agregado (o agregado passa por `padrao-agregado.ts`, que ainda não está ligado).
 *
 * Sem dado suficiente devolve texto vazio e o prompt fica igual ao de antes: nenhum palpite com
 * dois ou três vídeos.
 */
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { metricasVideoCliente, roteiros, videosCliente, type Objetivo, type Plataforma, type TipoAbertura } from "@/db/schema";
import { logger } from "@/lib/log";

import { medianaDaConta } from "./curva";

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

/** A janela dos vídeos considerados, a mesma do aprendizado das reprovações. */
export const JANELA_DIAS_DESEMPENHO = 90;
/** Só vídeo com a última medição a 72 horas ou mais da postagem: antes disso a curva ainda está subindo e o número engana para baixo. */
export const IDADE_MINIMA_DA_MEDIDA_H = 72;
/** Abaixo de 8 vídeos medidos nenhuma conclusão sai. */
export const MINIMO_VIDEOS_MEDIDOS = 8;
/** E um grupo (um objetivo, um tipo de abertura, uma faixa) precisa de 3 vídeos. */
export const MINIMO_VIDEOS_POR_GRUPO = 3;
/** A mediana do grupo, dividida pelo normal da conta: 1,5 ou mais "rendeu mais"; 0,67 ou menos "rendeu menos". */
export const LIMIAR_RENDEU_MAIS = 1.5;
export const LIMIAR_RENDEU_MENOS = 0.67;
export const MAXIMO_DE_LINHAS = 4;

export type Dimensao = "objetivo" | "gancho" | "duracao" | "horario";

/** Um vídeo postado e já medido, com o que se sabe do roteiro que o gerou. */
export type VideoMedido = {
  /** Views da última medição dividido pelo normal da conta. */
  multiplicador: number;
  objetivo: Objetivo;
  gancho: TipoAbertura | null;
  /** Só Reels falado curto tem duração comparável; o resto vem nulo. */
  duracaoS: number | null;
  /** Hora cheia do dia no fuso de Brasília, 0 a 23. */
  hora: number;
};

export type GrupoDeDesempenho = {
  dimensao: Dimensao;
  /** Complemento de "Vídeos ...": "feitos para mais gente te conhecer", "de até 20 segundos". */
  rotulo: string;
  videos: number;
  /** A mediana do multiplicador dos vídeos do grupo. */
  multiplicador: number;
  sentido: "mais" | "menos";
};

const ROTULO_OBJETIVO: Record<Objetivo, string> = {
  alcance: "feitos para mais gente te conhecer",
  engajamento: "feitos para lembrarem de você",
  conversao: "feitos para te chamarem para comprar",
};

const ROTULO_GANCHO: Partial<Record<TipoAbertura, string>> = {
  cena: "que abrem com uma cena",
  resultado: "que abrem pelo resultado",
  objeto: "que abrem mostrando um objeto",
  fala_direta: "que abrem falando direto com a pessoa",
  numero: "que abrem com um número",
  contraste: "que abrem com um contraste",
  pergunta: "que abrem com uma pergunta",
};

export function faixaDeDuracao(duracaoS: number): string {
  if (duracaoS <= 20) return "de até 20 segundos";
  if (duracaoS <= 40) return "de 21 a 40 segundos";
  if (duracaoS <= 60) return "de 41 a 60 segundos";
  return "de mais de 60 segundos";
}

export function faixaDeHorario(hora: number): string {
  if (hora >= 6 && hora < 12) return "postados de manhã (6h às 12h)";
  if (hora >= 12 && hora < 18) return "postados à tarde (12h às 18h)";
  if (hora >= 18) return "postados à noite (18h à meia-noite)";
  return "postados de madrugada (meia-noite às 6h)";
}

function mediana(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0 ? (ordenados[meio - 1] + ordenados[meio]) / 2 : ordenados[meio];
}

/**
 * Opções de quem lê o desempenho. `semDimensoes` tira uma dimensão ANTES de escolher as linhas: o roteiro longo tira a duração, porque a faixa de duração só mede Reels curto e a duração do
 * longo vem da medida dos longos do ramo (uma linha "de até 20 segundos" contradiria o pedido e ainda gastaria uma das quatro vagas).
 */
export type OpcoesDeDesempenho = { semDimensoes?: Dimensao[] };

/**
 * O que rendeu mais ou menos que o normal da conta, por dimensão. Puro (sem banco). Um grupo que
 * tem todos os vídeos da dimensão não diz nada (não há com o que comparar) e fica de fora.
 */
export function resumirDesempenho(videos: VideoMedido[], opcoes: OpcoesDeDesempenho = {}): GrupoDeDesempenho[] {
  if (videos.length < MINIMO_VIDEOS_MEDIDOS) return [];

  const candidatos: GrupoDeDesempenho[] = [];
  const dimensoes: { dimensao: Dimensao; rotulo: (v: VideoMedido) => string | null }[] = [
    { dimensao: "objetivo", rotulo: (v) => ROTULO_OBJETIVO[v.objetivo] ?? null },
    { dimensao: "gancho", rotulo: (v) => (v.gancho ? (ROTULO_GANCHO[v.gancho] ?? null) : null) },
    { dimensao: "duracao", rotulo: (v) => (v.duracaoS && v.duracaoS > 0 ? faixaDeDuracao(v.duracaoS) : null) },
    { dimensao: "horario", rotulo: (v) => faixaDeHorario(v.hora) },
  ];

  for (const { dimensao, rotulo } of dimensoes) {
    if (opcoes.semDimensoes?.includes(dimensao)) continue;
    const grupos = new Map<string, number[]>();
    let comRotulo = 0;
    for (const v of videos) {
      const r = rotulo(v);
      if (!r) continue;
      comRotulo += 1;
      grupos.set(r, [...(grupos.get(r) ?? []), v.multiplicador]);
    }
    for (const [r, valores] of grupos) {
      if (valores.length < MINIMO_VIDEOS_POR_GRUPO || valores.length === comRotulo) continue;
      const m = mediana(valores);
      if (m >= LIMIAR_RENDEU_MAIS) candidatos.push({ dimensao, rotulo: r, videos: valores.length, multiplicador: m, sentido: "mais" });
      else if (m <= LIMIAR_RENDEU_MENOS) candidatos.push({ dimensao, rotulo: r, videos: valores.length, multiplicador: m, sentido: "menos" });
    }
  }

  return candidatos
    .sort((a, b) => Math.abs(Math.log(b.multiplicador)) - Math.abs(Math.log(a.multiplicador)) || b.videos - a.videos || a.rotulo.localeCompare(b.rotulo))
    .slice(0, MAXIMO_DE_LINHAS);
}

function vezes(m: number): string {
  const texto = m.toFixed(1).replace(".", ",");
  return `${texto} ${texto === "1,0" ? "vez" : "vezes"}`;
}

/** O texto do bloco que entra no sistema do roteiro e da avaliação do tema; vazio sem conclusão. */
export function formatarDesempenhoDaConta(grupos: GrupoDeDesempenho[]): string {
  return grupos
    .map((g) => `- Vídeos ${g.rotulo} (${g.videos} vídeos): ${g.sentido === "mais" ? "renderam" : "renderam só"} ${vezes(g.multiplicador)} o normal da conta.`)
    .join("\n");
}

function horaEmBrasilia(data: Date): number {
  const hora = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(data);
  return Number(hora) % 24;
}

/**
 * Os vídeos postados pela marca, com a curva já medida e a idade da última medida passando de 72
 * horas, prontos para `resumirDesempenho`. Nunca devolve vídeo de outra marca: o filtro é pelo
 * `clienteId` do vídeo E do roteiro.
 */
export async function videosMedidosDaMarca(clienteId: number, agora: Date = new Date()): Promise<VideoMedido[]> {
  const desde = new Date(agora.getTime() - JANELA_DIAS_DESEMPENHO * DIA_MS);
  const postados = await db()
    .select({
      id: videosCliente.id,
      plataforma: videosCliente.plataforma,
      postadoEm: videosCliente.postadoEm,
      objetivo: roteiros.objetivo,
      tipoAbertura: roteiros.tipoAbertura,
      formato: roteiros.formato,
      duracaoDoVideo: roteiros.duracaoDoVideo,
      duracaoS: sql<number | null>`(${roteiros.conteudo}->>'duracaoS')::int`,
    })
    .from(videosCliente)
    .innerJoin(roteiros, and(eq(roteiros.id, videosCliente.roteiroId), eq(roteiros.clienteId, videosCliente.clienteId)))
    .where(and(eq(videosCliente.clienteId, clienteId), isNotNull(videosCliente.plataforma), gte(videosCliente.postadoEm, desde)));
  if (postados.length === 0) return [];

  const metricas = await db()
    .select({ videoClienteId: metricasVideoCliente.videoClienteId, views: metricasVideoCliente.views, coletadoEm: metricasVideoCliente.coletadoEm })
    .from(metricasVideoCliente)
    .where(inArray(metricasVideoCliente.videoClienteId, postados.map((p) => p.id)))
    .orderBy(desc(metricasVideoCliente.coletadoEm));
  const ultimaPorVideo = new Map<number, { views: number; coletadoEm: Date }>();
  for (const m of metricas) if (!ultimaPorVideo.has(m.videoClienteId)) ultimaPorVideo.set(m.videoClienteId, m);

  // O normal da conta de cada rede, uma vez só (-1 não exclui vídeo nenhum).
  const normalPorRede = new Map<Plataforma, number | null>();
  for (const rede of new Set(postados.map((p) => p.plataforma as Plataforma))) {
    const { mediana: normal, aprendendo } = await medianaDaConta(clienteId, rede, -1);
    normalPorRede.set(rede, aprendendo || !normal || normal <= 0 ? null : normal);
  }

  const medidos: VideoMedido[] = [];
  for (const p of postados) {
    const ultima = ultimaPorVideo.get(p.id);
    const normal = normalPorRede.get(p.plataforma as Plataforma);
    if (!ultima || !normal) continue;
    if (ultima.coletadoEm.getTime() - p.postadoEm.getTime() < IDADE_MINIMA_DA_MEDIDA_H * HORA_MS) continue;
    medidos.push({
      multiplicador: ultima.views / normal,
      objetivo: p.objetivo,
      gancho: p.tipoAbertura,
      duracaoS: p.formato === "reels" && p.duracaoDoVideo === "curto" ? p.duracaoS : null,
      hora: horaEmBrasilia(p.postadoEm),
    });
  }
  return medidos;
}

/**
 * O bloco do nível conta para o prompt, só desta marca. Qualquer falha devolve vazio: o
 * aprendizado ajuda o roteiro, nunca o trava.
 */
export async function desempenhoDaConta(clienteId: number, agora: Date = new Date(), opcoes: OpcoesDeDesempenho = {}): Promise<string> {
  try {
    return formatarDesempenhoDaConta(resumirDesempenho(await videosMedidosDaMarca(clienteId, agora), opcoes));
  } catch (erro) {
    logger.warn({ err: erro, clienteId }, "desempenho-da-conta: nao foi possivel ler; segue sem o bloco");
    return "";
  }
}
