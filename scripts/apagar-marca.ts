/**
 * E22 PR 2, item 0d: `npm run marca:apagar -- <id da marca> --confirmo`. Cancela a assinatura da marca no Stripe e só então apaga a marca e tudo que é dela. Sem `--confirmo` só mostra
 * o que faria. Usa `DATABASE_URL` e `STRIPE_SECRET_KEY` do ambiente (nunca imprime a chave). Apagar é definitivo: o backup do dia é o único caminho de volta.
 */
import "dotenv/config";

import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { clientes } from "../src/db/schema";
import { apagarMarca } from "../src/servicos/apagar-marca";
import { assinaturasDaMarca } from "../src/servicos/assinatura";

async function main() {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error("uso: npm run marca:apagar -- <id da marca> --confirmo");
    process.exit(1);
  }
  const [marca] = await db().select({ id: clientes.id, nome: clientes.nome }).from(clientes).where(eq(clientes.id, id));
  if (!marca) {
    console.error(`A marca ${id} nao existe.`);
    process.exit(1);
  }
  const assinaturas = await assinaturasDaMarca(id);
  console.log(`Marca ${marca.id} (${marca.nome}): ${assinaturas.length} assinatura(s) no historico.`);
  if (!process.argv.includes("--confirmo")) {
    console.log("Nada foi apagado. Rode de novo com --confirmo para cancelar no Stripe e apagar de vez.");
    return;
  }
  const r = await apagarMarca(id);
  console.log(`Apagada. Assinaturas canceladas no Stripe: ${r.assinaturasCanceladas}.`);
}

main()
  .catch((erro) => {
    console.error(`marca:apagar: ${String(erro?.message ?? erro).replace(/\b(sk|rk|pk)_(test|live)_\w+/g, "[chave]")}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
