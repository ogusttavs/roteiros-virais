/**
 * M2 (revisão de 23/11/2026): `npm run stripe:conferir -- <id da marca> [--corrigir]`. Lê as assinaturas da marca no Stripe e mostra a diferença com o banco; com `--corrigir`, acerta o
 * banco pelo Stripe (a mesma regra do aviso). É um script, não um job: se um aviso se perdeu depois dos 3 dias de reenvio do Stripe, é a mão do dono que decide. Usa `DATABASE_URL` e
 * `STRIPE_SECRET_KEY` do ambiente e nunca imprime a chave. A lógica está em `stripe-conferir-logica.ts`.
 */
import "dotenv/config";

import { getPool } from "../src/db";
import { criarPortaReal } from "../src/lib/stripe";
import { assinaturasDaMarca, tratarEventoDoStripe } from "../src/servicos/assinatura";

import { conferirMarca, relatorioEmTexto } from "./stripe-conferir-logica";

async function main() {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error("uso: npm run stripe:conferir -- <id da marca> [--corrigir]");
    process.exit(1);
  }
  const chave = process.env.STRIPE_SECRET_KEY ?? "";
  if (!chave) {
    console.error("stripe-conferir: STRIPE_SECRET_KEY nao esta definida.");
    process.exit(1);
  }
  const corrigir = process.argv.includes("--corrigir");
  const banco = await assinaturasDaMarca(id);
  const linhas = await conferirMarca({
    clienteId: id,
    banco,
    porta: criarPortaReal(chave),
    corrigir,
    // Sem e-mail ao admin: a correção não é um fato novo da cobrança.
    aplicar: (evento) => tratarEventoDoStripe(evento, null),
  });
  console.log(`stripe-conferir (${/^(sk|rk)_live_/.test(chave) ? "PRODUCAO" : "modo teste"}):`);
  console.log(relatorioEmTexto(id, linhas, corrigir));
}

main()
  .catch((erro) => {
    console.error(`stripe-conferir: ${String(erro?.message ?? erro).replace(/\b(sk|rk|pk)_(test|live)_\w+/g, "[chave]")}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
