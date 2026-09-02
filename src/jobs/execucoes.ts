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

/**
 * Roda uma tarefa de coleta com o registro completo: cria a linha "rodando"
 * antes, atualiza para "ok" (com o resumo) ou "erro" (com a mensagem) depois.
 * Um `ErroColeta` nao retentavel termina a execucao sem relancar, para o
 * pg-boss nao repetir um erro de dado; qualquer outro erro relanca.
 */
export async function executarComRegistro(
  nome: string,
  tarefa: () => Promise<Record<string, unknown>>,
): Promise<void> {
  const [execucao] = await db().insert(execucoesJob).values({ nome, status: "rodando" }).returning();

  try {
    const resumo = await tarefa();
    await db()
      .update(execucoesJob)
      .set({ status: "ok", resumo, terminadoEm: new Date() })
      .where(eq(execucoesJob.id, execucao.id));
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await db()
      .update(execucoesJob)
      .set({ status: "erro", erro: mensagem, terminadoEm: new Date() })
      .where(eq(execucoesJob.id, execucao.id));

    if (erro instanceof ErroColeta && !erro.retentavel) {
      return;
    }
    throw erro;
  }
}
