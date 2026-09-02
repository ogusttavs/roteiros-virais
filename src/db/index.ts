/**
 * Conexao com o Postgres (desenvolvimento via compose.dev.yml, producao no VPS).
 * Uma unica instancia por processo, guardada em globalThis para sobreviver ao
 * recarregamento de modulos do Next em desenvolvimento.
 */
import "dotenv/config";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const g = globalThis as unknown as { __rvPool?: Pool; __rvDb?: Db };

function url(): string {
  const u = process.env.DATABASE_URL;
  if (!u)
    throw new Error(
      "DATABASE_URL nao definida. Copie .env.example para .env e rode npm run db:up.",
    );
  return u;
}

export function getPool(): Pool {
  if (!g.__rvPool) g.__rvPool = new Pool({ connectionString: url(), max: 8 });
  return g.__rvPool;
}

export function db(): Db {
  if (!g.__rvDb) g.__rvDb = drizzle(getPool(), { schema });
  return g.__rvDb;
}

export { schema };
