/**
 * E22 PR 2, item 0d: apagar uma marca. Não existe botão para isso no painel (decisão de produto: a conta de um cliente só some por pedido dele e com cuidado); este é o único caminho
 * certo, para quando o Gustavo precisar (`npm run marca:apagar`). Apagar a marca sem cuidado deixaria o Stripe cobrando uma conta que não existe mais; por isso `assinaturas.cliente_id` é `ON DELETE RESTRICT` (E22 PR 3) e a linha da assinatura sai
 * daqui, na mesma transação, antes da marca. Por isso o Stripe é cancelado ANTES de a marca sumir de vez.
 *
 * Tudo numa transação, nesta ordem: (1) lê o que há para cancelar; (2) apaga a marca (o banco recusa se ela tem histórico: briefing, roteiros, gerações, e então NADA foi cancelado);
 * (3) cancela no Stripe (se falhar, a transação desfaz o passo 2 e a marca fica como estava); (4) só então confirma. O pior caso que sobra é o Stripe cancelar e a confirmação do
 * banco falhar: a marca continua existindo com a assinatura cancelada, que é o lado seguro. Apagar a linha por SQL à mão passa por cima de tudo isto: nunca faça (`deploy/README.md`).
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assinaturas, clientes } from "@/db/schema";
import { alvosDoCancelamento, cancelarNoStripe } from "@/servicos/assinatura";

export class ErroApagarMarca extends Error {}

/** Devolve quantas assinaturas foram canceladas no Stripe. Marca que não existe: erro. */
export async function apagarMarca(clienteId: number): Promise<{ assinaturasCanceladas: number }> {
  return db().transaction(async (tx) => {
    const [marca] = await tx.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, clienteId));
    if (!marca) throw new ErroApagarMarca(`A marca ${clienteId} nao existe.`);
    const alvos = await alvosDoCancelamento(clienteId, tx);
    // E22 PR 3: `assinaturas.cliente_id` é `ON DELETE RESTRICT` (não cascata mais): a linha da assinatura sai aqui, na mesma transação, antes da marca. Se o Stripe falhar adiante, tudo desfaz.
    await tx.delete(assinaturas).where(eq(assinaturas.clienteId, clienteId));
    await tx.delete(clientes).where(eq(clientes.id, clienteId));
    const assinaturasCanceladas = await cancelarNoStripe(clienteId, alvos);
    return { assinaturasCanceladas };
  });
}
