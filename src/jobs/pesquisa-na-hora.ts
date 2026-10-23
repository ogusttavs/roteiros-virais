/**
 * Job `pesquisa-na-hora` (E54): por evento, nunca por horário. `criarPesquisa` (`servicos/pesquisa-na-hora.ts`) grava o pedido e manda
 * `{ pesquisaId }`; aqui a busca roda, os dados passam pelas travas e a pesquisa fica "pronta", "sem_achados" ou "erro". Sem repetição
 * automática da fila: cada tentativa gastaria buscas pagas, e a pessoa decide se pede de novo.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { pesquisasNaHora } from "@/db/schema";
import { marcaPodeReceberTarefa, registrarMarcasPuladas, resumoDasMarcasPuladas } from "@/servicos/assinatura-tarefas";
import { executarPesquisa, type DepsDaPesquisa } from "@/servicos/pesquisa-na-hora";

/** O que a pessoa lê se a assinatura venceu entre o pedido e a busca (raro: o pedido já passa pelo portão da ação). */
const MOTIVO_SEM_ASSINATURA = "A pesquisa não rodou porque a assinatura desta conta não está ativa. Assine de novo para pesquisar.";

export type PayloadPesquisaNaHora = { pesquisaId: number };

/** O que o worker registra em `execucoes_job`: o resumo da pesquisa (quantos dados, quantas buscas, o custo). */
export async function rodarPesquisaNaHora(pesquisaId: number, deps: DepsDaPesquisa = {}): Promise<Record<string, unknown>> {
  if (!Number.isInteger(pesquisaId) || pesquisaId <= 0) throw new Error("uso: npm run job -- pesquisa-na-hora <pesquisaId>");
  // E22 PR 3: marca sem assinatura (cobrança ligada) não gasta buscas pagas. A pesquisa que ainda esperava vira "erro" com o motivo, sem rodar a busca.
  const [pedida] = await db().select({ clienteId: pesquisasNaHora.clienteId, status: pesquisasNaHora.status }).from(pesquisasNaHora).where(eq(pesquisasNaHora.id, pesquisaId));
  if (pedida && pedida.status === "pesquisando" && !(await marcaPodeReceberTarefa(pedida.clienteId))) {
    await db()
      .update(pesquisasNaHora)
      .set({ status: "erro", motivo: MOTIVO_SEM_ASSINATURA, terminadoEm: new Date() })
      .where(and(eq(pesquisasNaHora.id, pesquisaId), eq(pesquisasNaHora.status, "pesquisando")));
    registrarMarcasPuladas("pesquisa-na-hora", 1);
    return { pesquisaId, status: "erro", pulado: "assinatura", ...resumoDasMarcasPuladas(1) };
  }
  const resumo = await executarPesquisa(pesquisaId, deps);
  return { ...resumo };
}
