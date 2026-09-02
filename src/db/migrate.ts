import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db, getPool } from "./index";

migrate(db(), { migrationsFolder: process.env.MIGRATIONS_DIR || "./drizzle" })
  .then(async () => {
    console.log("Migracoes aplicadas.");
    await getPool().end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("Falha ao migrar:", e);
    await getPool().end();
    process.exit(1);
  });
