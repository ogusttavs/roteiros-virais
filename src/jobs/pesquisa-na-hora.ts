/**
 * Job `pesquisa-na-hora` (E54): por evento, nunca por horário. `criarPesquisa` (`servicos/pesquisa-na-hora.ts`) grava o pedido e manda
 * `{ pesquisaId }`; aqui a busca roda, os dados passam pelas travas e a pesquisa fica "pronta", "sem_achados" ou "erro". Sem repetição
 * automática da fila: cada tentativa gastaria buscas pagas, e a pessoa decide se pede de novo.
 */
import { executarPesquisa, type DepsDaPesquisa } from "@/servicos/pesquisa-na-hora";

export type PayloadPesquisaNaHora = { pesquisaId: number };

/** O que o worker registra em `execucoes_job`: o resumo da pesquisa (quantos dados, quantas buscas, o custo). */
export async function rodarPesquisaNaHora(pesquisaId: number, deps: DepsDaPesquisa = {}): Promise<Record<string, unknown>> {
  if (!Number.isInteger(pesquisaId) || pesquisaId <= 0) throw new Error("uso: npm run job -- pesquisa-na-hora <pesquisaId>");
  const resumo = await executarPesquisa(pesquisaId, deps);
  return { ...resumo };
}
