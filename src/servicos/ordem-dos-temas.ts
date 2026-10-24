/**
 * A ordem dos temas do dia para cada marca (E16, parte 4). Os temas do dia nascem por SETOR
 * (`temas_dia` tem uma linha por setor e dia) e todas as marcas do setor leem a mesma lista; o
 * texto e a lista continuam sendo os do setor. O que muda de marca para marca é só a ordem: quando
 * a própria marca tem dado suficiente (o critério de `desempenho-da-conta.ts`) e um objetivo
 * rendeu claramente mais na conta dela, os temas que puxam para esse objetivo sobem.
 *
 * Tudo por código, sem IA, e tudo de uma marca só: o objetivo que rende sai dos vídeos medidos da
 * PRÓPRIA marca (`videosMedidosDaMarca` filtra por `clienteId`), e dele sobra apenas o nome de um
 * objetivo, nunca número, tema nem texto. Nada da marca A pode mudar a ordem da marca B.
 *
 * Sem dado suficiente, ou sem um objetivo que se destaque, a ordem é a de sempre.
 */
import type { Objetivo, TemaDoDia } from "@/db/schema";
import { logger } from "@/lib/log";

import { LIMIAR_RENDEU_MAIS, MINIMO_VIDEOS_MEDIDOS, MINIMO_VIDEOS_POR_GRUPO, videosMedidosDaMarca, type VideoMedido } from "./desempenho-da-conta";

/**
 * "Claramente": o melhor objetivo precisa passar do segundo melhor (entre os que têm vídeos
 * suficientes para comparar) por pelo menos 20%. Dois objetivos empatados em cima não elegem
 * ninguém, e a ordem fica a de sempre.
 */
export const VANTAGEM_MINIMA_ENTRE_OBJETIVOS = 1.2;

function mediana(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0 ? (ordenados[meio - 1] + ordenados[meio]) / 2 : ordenados[meio];
}

/**
 * O objetivo que rendeu claramente mais na conta, ou nulo. Puro (sem banco). Exige o mesmo mínimo
 * de `resumirDesempenho` (8 vídeos medidos, 3 por objetivo, mediana do objetivo a 1,5 vez o normal
 * da conta ou mais) e que haja com o que comparar: uma conta que só fez um objetivo não diz nada.
 */
export function objetivoQueMaisRende(videos: VideoMedido[]): Objetivo | null {
  if (videos.length < MINIMO_VIDEOS_MEDIDOS) return null;

  const porObjetivo = new Map<Objetivo, number[]>();
  for (const v of videos) porObjetivo.set(v.objetivo, [...(porObjetivo.get(v.objetivo) ?? []), v.multiplicador]);
  if (porObjetivo.size < 2) return null;

  const ranking = [...porObjetivo.entries()]
    .filter(([, valores]) => valores.length >= MINIMO_VIDEOS_POR_GRUPO)
    .map(([objetivo, valores]) => ({ objetivo, mediana: mediana(valores) }))
    .sort((a, b) => b.mediana - a.mediana);

  const [melhor, segundo] = ranking;
  if (!melhor || melhor.mediana < LIMIAR_RENDEU_MAIS) return null;
  if (segundo && melhor.mediana < segundo.mediana * VANTAGEM_MINIMA_ENTRE_OBJETIVOS) return null;
  return melhor.objetivo;
}

/**
 * Os temas que puxam para o objetivo que rende sobem, sem mexer na ordem entre os que sobem nem
 * entre os que ficam. O tema do momento (`doMomento`, E55) nasce de um assunto em alta, não do
 * padrão da marca: fica onde está, e os outros se arrumam nos lugares que sobram. Sem objetivo,
 * devolve a mesma lista.
 */
export function ordenarTemasPeloQueRende(temas: TemaDoDia[], objetivo: Objetivo | null): TemaDoDia[] {
  if (!objetivo) return temas;

  const lugares: number[] = [];
  const doSetor: TemaDoDia[] = [];
  temas.forEach((tema, i) => {
    if (tema.doMomento) return;
    lugares.push(i);
    doSetor.push(tema);
  });

  const reordenados = [...doSetor.filter((t) => t.puxaPara === objetivo), ...doSetor.filter((t) => t.puxaPara !== objetivo)];
  const resultado = [...temas];
  lugares.forEach((lugar, i) => {
    resultado[lugar] = reordenados[i];
  });
  return resultado;
}

/**
 * O objetivo que mais rende na conta desta marca, lido dos vídeos medidos dela. Qualquer falha
 * devolve nulo: a ordem por marca ajuda a escolher, nunca trava a tela dos temas.
 */
export async function objetivoQueRendeNaConta(clienteId: number, agora: Date = new Date()): Promise<Objetivo | null> {
  try {
    return objetivoQueMaisRende(await videosMedidosDaMarca(clienteId, agora));
  } catch (erro) {
    logger.warn({ err: erro, clienteId }, "ordem-dos-temas: nao foi possivel ler o desempenho; segue na ordem do setor");
    return null;
  }
}
