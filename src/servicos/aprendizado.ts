/**
 * A memória do cliente (E27, parte 2): as regras que `src/jobs/
 * aprender-cliente.ts` compila a partir das reprovações. Consulta e as duas
 * ações do cliente ("Não é bem assim" e "Desfazer") moram aqui; a
 * consolidação (o que soma contagem, o que nunca ressuscita) mora no job,
 * porque só ele decide o conjunto inteiro de uma vez.
 */
import { and, asc, count, desc, eq, gte, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { aprendizadoCliente, roteiros, type AprendizadoCliente } from "@/db/schema";
import { DIA_MS, JANELA_DIAS } from "@/jobs/aprender-cliente";

export class ErroAprendizado extends Error {}

export type RegraCliente = {
  id: number;
  regra: string;
  motivoOrigem: string | null;
  contagem: number;
  primeiraEm: Date;
  ultimaEm: Date;
  ativa: boolean;
  desativadaEm: Date | null;
};

function paraRegraCliente(linha: AprendizadoCliente): RegraCliente {
  return {
    id: linha.id,
    regra: linha.regra,
    motivoOrigem: linha.motivoOrigem,
    contagem: linha.contagem,
    primeiraEm: linha.primeiraEm,
    ultimaEm: linha.ultimaEm,
    ativa: linha.ativa,
    desativadaEm: linha.desativadaEm,
  };
}

/**
 * Todas as regras do cliente, ativas e desativadas, por `primeiraEm`
 * crescente, `id` como desempate (Briefing e admin do cliente, segunda
 * rodada do PR #42, item 1). Nunca por `ativa`: assim a regra não muda de
 * lugar na lista quando o cliente clica "Não é bem assim", só troca de
 * estado onde já estava. Nunca mistura cliente (isolamento no nível da
 * consulta, mesmo padrão de `roteiroPorId`).
 */
export async function regrasDoCliente(clienteId: number): Promise<RegraCliente[]> {
  const linhas = await db()
    .select()
    .from(aprendizadoCliente)
    .where(eq(aprendizadoCliente.clienteId, clienteId))
    .orderBy(asc(aprendizadoCliente.primeiraEm), asc(aprendizadoCliente.id));
  return linhas.map(paraRegraCliente);
}

/**
 * Quantas vezes o cliente reprovou um roteiro nos últimos 90 dias (Briefing
 * e admin do cliente, segunda rodada do PR #42, item 3): conta linhas de
 * `roteiros` com `reprovadoEm` preenchido, não a soma de `contagem` das
 * regras, que soma cada motivo por separado e contava a mesma reprovação
 * de dois motivos duas vezes. Mesma janela do job `aprender-cliente`.
 */
export async function contarReprovacoes(clienteId: number): Promise<number> {
  const desde = new Date(Date.now() - JANELA_DIAS * DIA_MS);
  const [linha] = await db()
    .select({ total: count() })
    .from(roteiros)
    .where(and(eq(roteiros.clienteId, clienteId), isNotNull(roteiros.reprovadoEm), gte(roteiros.reprovadoEm, desde)));
  return linha?.total ?? 0;
}

/**
 * Só as ativas, para o bloco "o que este cliente já reprovou" nos prompts
 * do roteiro (`servicos/roteiro.ts`, `gerarConteudo`). Ordenada por
 * contagem: a regra firme (duas reprovações ou mais) entra primeiro.
 */
export async function regrasAtivasDoCliente(
  clienteId: number,
): Promise<{ regra: string; contagem: number }[]> {
  const linhas = await db()
    .select({ regra: aprendizadoCliente.regra, contagem: aprendizadoCliente.contagem })
    .from(aprendizadoCliente)
    .where(and(eq(aprendizadoCliente.clienteId, clienteId), eq(aprendizadoCliente.ativa, true)))
    .orderBy(desc(aprendizadoCliente.contagem));
  return linhas;
}

/**
 * "Não é bem assim" (Briefing): desativa uma regra do próprio cliente.
 * `clienteId` confere posse antes de mexer, mesmo padrão de
 * `roteiroPorId`/`marcarGravado`: nunca por id sozinho.
 */
export async function desativarRegra(clienteId: number, regraId: number): Promise<void> {
  const [linha] = await db()
    .update(aprendizadoCliente)
    .set({ ativa: false, desativadaEm: new Date(), atualizadoEm: new Date() })
    .where(and(eq(aprendizadoCliente.id, regraId), eq(aprendizadoCliente.clienteId, clienteId)))
    .returning({ id: aprendizadoCliente.id });
  if (!linha) throw new ErroAprendizado("regra nao encontrada.");
}

/** "Desfazer" (Briefing): reativa uma regra que o próprio cliente havia desativado. */
export async function reativarRegra(clienteId: number, regraId: number): Promise<void> {
  const [linha] = await db()
    .update(aprendizadoCliente)
    .set({ ativa: true, desativadaEm: null, atualizadoEm: new Date() })
    .where(and(eq(aprendizadoCliente.id, regraId), eq(aprendizadoCliente.clienteId, clienteId)))
    .returning({ id: aprendizadoCliente.id });
  if (!linha) throw new ErroAprendizado("regra nao encontrada.");
}
