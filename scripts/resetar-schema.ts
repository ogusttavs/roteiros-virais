/**
 * Derruba o schema "public" (e o "drizzle", que guarda o historico de
 * migracoes, senao o migrate acha que ja aplicou tudo) e reaplica as
 * migracoes do zero. Sem process.exit, para reusar no db:reset e no teste de
 * integracao do seed.
 */
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import type { Db } from "../src/db";

export async function resetarSchema(db: Db): Promise<void> {
  await db.execute(sql`
    drop schema if exists public cascade;
    create schema public;
    drop schema if exists drizzle cascade;
  `);
  await migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR || "./drizzle" });
}
