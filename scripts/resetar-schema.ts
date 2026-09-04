/**
 * Derruba o schema "public" (e o "drizzle", que guarda o historico de
 * migracoes, senao o migrate acha que ja aplicou tudo) e reaplica as
 * migracoes do zero. Sem process.exit, para reusar no db:reset e no teste de
 * integracao do seed.
 *
 * Guarda (PROXIMO.md, etapa 3): nunca roda em producao nem contra um banco
 * que nao seja claramente local, porque derruba dados de verdade.
 */
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import type { Db } from "../src/db";

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "postgres"]);

export class ResetProibidoError extends Error {}

export function verificarAmbienteSeguro(
  env: { NODE_ENV?: string; DATABASE_URL?: string } = process.env,
): void {
  if (env.NODE_ENV === "production") {
    throw new ResetProibidoError("NODE_ENV e production; db:reset nunca roda em producao.");
  }

  if (!env.DATABASE_URL) {
    throw new ResetProibidoError("DATABASE_URL nao definida, nada para resetar.");
  }

  let host: string;
  try {
    host = new URL(env.DATABASE_URL).hostname;
  } catch {
    throw new ResetProibidoError(`DATABASE_URL invalida: ${env.DATABASE_URL}`);
  }

  if (!HOSTS_LOCAIS.has(host)) {
    throw new ResetProibidoError(
      `db:reset so roda contra um banco local (localhost, 127.0.0.1 ou postgres); DATABASE_URL aponta para "${host}".`,
    );
  }

  /**
   * Etapa 11, ajuste 1 da revisao da etapa 10: tres vezes em dois dias o
   * banco de trabalho `roteiros` foi apagado por engano, com dado que
   * custou credito de API para coletar. A regra em documento
   * (FLUXO.md, "Um Postgres local, varias sessoes") nao bastou; agora e o
   * codigo que recusa. `roteiros_teste`, `roteiros_dev`, `roteiros_revisao`
   * e `roteiros_ci` (sufixo do nome) continuam permitidos, e tambem
   * `postgres` (banco padrao usado pela CI).
   */
  const nomeBanco = new URL(env.DATABASE_URL).pathname.replace(/^\//, "");
  if (nomeBanco === "roteiros") {
    throw new ResetProibidoError(
      'db:reset recusa o banco de trabalho "roteiros" (tem dado real que custou credito de API). ' +
        'Use um banco com sufixo, como "roteiros_teste" ou "roteiros_dev".',
    );
  }
}

export async function resetarSchema(db: Db): Promise<void> {
  verificarAmbienteSeguro();

  await db.execute(sql`
    drop schema if exists public cascade;
    create schema public;
    drop schema if exists drizzle cascade;
  `);
  await migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR || "./drizzle" });
}
