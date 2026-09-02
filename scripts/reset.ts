/**
 * npm run db:reset: derruba o schema do banco (nao o container Docker, que
 * continua com npm run db:up/db:down), aplica as migracoes e semeia. Para
 * deixar o ambiente local pronto do zero.
 */
import { db, getPool } from "../src/db";

import { resetarSchema } from "./resetar-schema";
import { semear } from "./semear";

async function resetar() {
  await resetarSchema(db());
  return semear(db());
}

resetar()
  .then(async (resumo) => {
    console.log(
      `Banco derrubado, migrado e semeado: ${resumo.nichos} nicho(s), ${resumo.contas} conta(s), ${resumo.clientes} cliente(s), ${resumo.videos} video(s).`,
    );
    await getPool().end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("Falha no reset:", e);
    await getPool().end();
    process.exit(1);
  });
