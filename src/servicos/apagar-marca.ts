/**
 * E22 PR 2, item 0d: apagar uma marca. Não existe botão para isso no painel (decisão de produto: a conta de um cliente só some por pedido dele e com cuidado); este é o único
 * caminho certo, para quando o Gustavo precisar (`npm run marca:apagar`). Ele cancela a assinatura no Stripe ANTES de apagar: o `ON DELETE CASCADE` do banco apagaria a linha
 * de `assinaturas` e o Stripe continuaria cobrando uma conta que não existe mais. Se o Stripe falhar, a marca NÃO é apagada. Apagar a linha por SQL à mão passa por cima disto:
 * nunca faça (`deploy/README.md`, "A assinatura pelo Stripe").
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { clientes } from "@/db/schema";
import { cancelarAssinaturasDaMarca } from "@/servicos/assinatura";

export class ErroApagarMarca extends Error {}

/** Devolve quantas assinaturas foram canceladas no Stripe. Marca que não existe: erro. */
export async function apagarMarca(clienteId: number): Promise<{ assinaturasCanceladas: number }> {
  const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.id, clienteId));
  if (!marca) throw new ErroApagarMarca(`A marca ${clienteId} nao existe.`);
  // O Stripe primeiro: se falhar, lança aqui e a marca fica como estava.
  const assinaturasCanceladas = await cancelarAssinaturasDaMarca(clienteId);
  await db().delete(clientes).where(eq(clientes.id, clienteId));
  return { assinaturasCanceladas };
}
