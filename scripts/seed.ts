/**
 * Ponto de entrada de linha de comando (npm run db:seed). Os dados estao em
 * semear.ts, sem process.exit, para dar para reusar no db:reset.
 */
import { db, getPool } from "../src/db";

import { semear } from "./semear";

semear(db())
  .then(async (resumo) => {
    console.log(
      `Banco semeado: ${resumo.nichos} nicho(s), ${resumo.contas} conta(s), ${resumo.clientes} cliente(s), ${resumo.videos} video(s).`,
    );
    await getPool().end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("Falha ao semear:", e);
    await getPool().end();
    process.exit(1);
  });
