/**
 * E22 PR 1: `npm run stripe:preparar` cria (ou acha) o produto e o preço do plano trimestral no Stripe. Idempotente: rodar de novo não cria nada. Usa `STRIPE_SECRET_KEY` do ambiente
 * e **nunca a imprime**. Recusa chave de produção (`sk_live_`, `rk_live_`) sem `--producao`: a preparação de teste é a que se roda à toa. A lógica está em
 * `stripe-preparar-logica.ts`.
 */
import "dotenv/config";

import Stripe from "stripe";

import { ErroDePreparo, prepararStripe, type StripeLike } from "./stripe-preparar-logica";

async function main() {
  const chave = process.env.STRIPE_SECRET_KEY ?? "";
  if (!chave) {
    console.error("stripe-preparar: STRIPE_SECRET_KEY nao esta definida.");
    process.exit(1);
  }
  const ehProducao = /^(sk|rk)_live_/.test(chave);
  if (ehProducao && !process.argv.includes("--producao")) {
    console.error("stripe-preparar: a chave e de producao; rode com --producao se for isso mesmo.");
    process.exit(1);
  }
  const stripe = new Stripe(chave, { maxNetworkRetries: 2, appInfo: { name: "roteiros-virais-preparar" } });
  const relatorio = await prepararStripe(stripe as unknown as StripeLike);
  console.log(`stripe-preparar (${ehProducao ? "PRODUCAO" : "modo teste"}):`);
  console.log(`  produto ${relatorio.produtoId}: ${relatorio.criouProduto ? "criado" : "ja existia"}`);
  console.log(`  preco ${relatorio.precoId}: ${relatorio.criouPreco ? "criado" : "ja existia"}`);
  console.log(`  portal do cliente ${relatorio.portalId}: ${relatorio.criouPortal ? "criado" : "ja existia"}`);
}

main().catch((erro) => {
  if (erro instanceof ErroDePreparo) {
    console.error(`stripe-preparar: ${erro.message}`);
  } else {
    // So o tipo e a mensagem, e qualquer coisa com cara de chave do Stripe sai riscada (a mensagem de "chave invalida" do SDK cita um pedaco dela).
    const mensagem = String(erro?.message ?? erro).replace(/\b(sk|rk|pk)_(test|live)_\w+/g, "[chave]");
    console.error(`stripe-preparar: o Stripe respondeu com erro: ${erro?.type ?? "erro"}: ${mensagem}`);
  }
  process.exit(1);
});
