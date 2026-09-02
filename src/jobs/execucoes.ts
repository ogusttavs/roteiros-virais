/**
 * Registro de execucao (etapa 6, decisao do Fable): toda chamada de job
 * grava inicio, fim, estado e resumo em `execucoes_job`, e decide se um
 * erro deve fazer o pg-boss tentar de novo.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { execucoesJob } from "@/db/schema";

/**
 * Erro nomeado de uma coleta, com uma decisao explicita: `retentavel: true`
 * (erro de rede, o pg-boss deve tentar de novo) ou `retentavel: false` (erro
 * de dado, refazer a mesma chamada nao muda o resultado).
 */
export class ErroColeta extends Error {
  constructor(
    message: string,
    public readonly retentavel: boolean,
  ) {
    super(message);
  }
}

export type ResultadoExecucao =
  | { status: "ok"; resumo: Record<string, unknown> }
  | { status: "erro"; erro: string };

/**
 * Roda uma tarefa de coleta com o registro completo: cria a linha "rodando"
 * antes, atualiza para "ok" (com o resumo) ou "erro" (com a mensagem) depois.
 * Um `ErroColeta` nao retentavel termina a execucao sem relancar (devolve
 * `{ status: "erro" }` em vez de rejeitar), para o pg-boss nao repetir um
 * erro de dado; quem chama ainda sabe que a execucao falhou olhando o
 * `status` devolvido. Qualquer outro erro relanca (e o pg-boss tenta de
 * novo).
 */
export async function executarComRegistro(
  nome: string,
  tarefa: () => Promise<Record<string, unknown>>,
): Promise<ResultadoExecucao> {
  const [execucao] = await db().insert(execucoesJob).values({ nome, status: "rodando" }).returning();

  try {
    const resumo = await tarefa();
    await db()
      .update(execucoesJob)
      .set({ status: "ok", resumo, terminadoEm: new Date() })
      .where(eq(execucoesJob.id, execucao.id));
    return { status: "ok", resumo };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await db()
      .update(execucoesJob)
      .set({ status: "erro", erro: mensagem, terminadoEm: new Date() })
      .where(eq(execucoesJob.id, execucao.id));

    if (erro instanceof ErroColeta && !erro.retentavel) {
      return { status: "erro", erro: mensagem };
    }
    throw erro;
  }
}
