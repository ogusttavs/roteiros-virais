/**
 * O custo fora da IA (custo que falta no admin): cada chamada paga à Groq (transcrição, por minuto de áudio) ou ao Apify (coleta, por execução) vira uma linha em `custos_externos`, com o custo em
 * dólar (o que a API devolve, ou o preço da data de `config/precos-ia.ts` quando ela não devolve), a unidade medida e, quando se sabe, a execução e o ramo. Registrar nunca derruba o que
 * está sendo feito: se o banco falhar, o gasto só fica sem linha e o log avisa.
 */
import { precoApifyPorMilResultados, PRECO_GROQ_USD_POR_HORA, SEGUNDOS_MINIMOS_COBRADOS_GROQ } from "@/config/precos-ia";
import { db } from "@/db";
import { custosExternos, type CustoExterno } from "@/db/schema";
import { contextoDaExecucao } from "@/jobs/contexto-execucao";
import { logger } from "@/lib/log";

/** O custo estimado de uma transcrição pela Groq: segundos de áudio (com o mínimo cobrado por pedido) a US$ por hora. */
export function custoDaTranscricaoGroqUsd(duracaoS: number): number {
  const cobrados = Math.max(SEGUNDOS_MINIMOS_COBRADOS_GROQ, duracaoS);
  return (cobrados / 3600) * PRECO_GROQ_USD_POR_HORA;
}

/** O custo estimado de uma coleta no Apify pelo preço do ator da data (US$ por mil resultados), quando a API não devolve o custo da execução. */
export function custoEstimadoDoApifyUsd(ator: string, resultados: number): number {
  return (resultados / 1000) * precoApifyPorMilResultados(ator);
}

type NovoCusto = {
  fonte: CustoExterno["fonte"];
  custoUsd: number;
  unidades: number;
  unidade: CustoExterno["unidade"];
  origemDoCusto: CustoExterno["origemDoCusto"];
  /** O ramo; sem ele, vale o do contexto da execução (se houver). */
  ramoId?: number | null;
  detalhe?: Record<string, unknown>;
};

/** Grava um custo fora da IA, ligado à execução em andamento e ao ramo. Nunca lança. */
export async function registrarCustoExterno(dados: NovoCusto): Promise<void> {
  try {
    const contexto = contextoDaExecucao();
    await db()
      .insert(custosExternos)
      .values({
        fonte: dados.fonte,
        custoUsd: Math.max(0, dados.custoUsd).toFixed(6),
        unidades: Math.max(0, dados.unidades).toFixed(3),
        unidade: dados.unidade,
        origemDoCusto: dados.origemDoCusto,
        ramoId: dados.ramoId !== undefined ? dados.ramoId : (contexto?.ramoId ?? null),
        execucaoId: contexto?.execucaoId ?? null,
        detalhe: dados.detalhe ?? null,
      });
  } catch (erro) {
    logger.warn({ err: erro, fonte: dados.fonte }, "nao foi possivel registrar o custo fora da IA");
  }
}
