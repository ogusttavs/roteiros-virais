/**
 * Teste de integracao minimo da etapa 1: so confere que DATABASE_URL aponta
 * para um Postgres de verdade e que a conexao funciona. O schema e as
 * migracoes entram na etapa 2; ainda nao ha tabela para testar.
 */
import { afterAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db/index";

describe("conexao com o Postgres", () => {
  afterAll(async () => {
    await getPool().end();
  });

  it("roda uma consulta simples", async () => {
    const resultado = await db().execute("select 1 as ok");
    expect(resultado.rows[0]).toEqual({ ok: 1 });
  });
});
