/**
 * Registro de execucao (etapa 6, criterio de aceite): toda tarefa grava
 * inicio, fim, estado e resumo em execucoes_job; um erro de dado nao relanca
 * (pg-boss nao repete), um erro de rede relanca (pg-boss repete).
 */
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { execucoesJob } from "@/db/schema";
import { ErroColeta, executarComRegistro } from "@/jobs/execucoes";

import { resetarSchema } from "../../scripts/resetar-schema";

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

async function ultimaExecucao(nome: string) {
  const [linha] = await db()
    .select()
    .from(execucoesJob)
    .where(eq(execucoesJob.nome, nome))
    .orderBy(desc(execucoesJob.id))
    .limit(1);
  return linha;
}

describe("executarComRegistro", () => {
  it("tarefa com sucesso grava status ok, devolve o resumo", async () => {
    const resultado = await executarComRegistro("teste-ok", async () => ({ processados: 3 }));
    expect(resultado).toEqual({ status: "ok", resumo: { processados: 3 } });

    const execucao = await ultimaExecucao("teste-ok");
    expect(execucao.status).toBe("ok");
    expect(execucao.resumo).toEqual({ processados: 3 });
    expect(execucao.terminadoEm).not.toBeNull();
    expect(execucao.erro).toBeNull();
  });

  it("ErroColeta nao retentavel grava status erro, nao relanca, mas devolve o status de erro", async () => {
    const resultado = await executarComRegistro("teste-erro-dado", async () => {
      throw new ErroColeta("resposta da api sem os campos esperados", false);
    });
    expect(resultado).toEqual({ status: "erro", erro: "resposta da api sem os campos esperados" });

    const execucao = await ultimaExecucao("teste-erro-dado");
    expect(execucao.status).toBe("erro");
    expect(execucao.erro).toBe("resposta da api sem os campos esperados");
  });

  it("ErroColeta retentavel grava status erro e relanca, para o pg-boss tentar de novo", async () => {
    await expect(
      executarComRegistro("teste-erro-rede", async () => {
        throw new ErroColeta("timeout de rede", true);
      }),
    ).rejects.toThrow("timeout de rede");

    const execucao = await ultimaExecucao("teste-erro-rede");
    expect(execucao.status).toBe("erro");
  });

  it("erro comum (nao ErroColeta) tambem relanca, por seguranca", async () => {
    await expect(
      executarComRegistro("teste-erro-generico", async () => {
        throw new Error("algo quebrou");
      }),
    ).rejects.toThrow("algo quebrou");

    const execucao = await ultimaExecucao("teste-erro-generico");
    expect(execucao.status).toBe("erro");
    expect(execucao.erro).toBe("algo quebrou");
  });
});
