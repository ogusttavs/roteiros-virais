/**
 * Job `varrer-pedidos` (E74 PR 2a): de minuto em minuto, fecha o pedido de geração que parou sem batimento além do prazo do tipo (o servidor reiniciou no meio da escrita, por exemplo). O roteiro
 * que já tinha versões vira pronto com elas; o resto falha com a frase de que não conta no limite, e só então a tela oferece "Tentar de novo". O resumo tem só números.
 */
import { varrerPedidosParados } from "@/servicos/pedidos";

export async function rodarVarrerPedidos(agora = new Date()): Promise<Record<string, unknown>> {
  return { ...(await varrerPedidosParados(agora)) };
}
