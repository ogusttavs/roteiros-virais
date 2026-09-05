"use server";

import { aceitarTermos, clienteDaSessaoAtual } from "@/servicos/clientes";

/**
 * Aceite dos termos no primeiro acesso (etapa 12, decisão 7 do
 * `PROXIMO.md`). O cliente sempre vem da sessão, nunca de um parâmetro
 * (isolamento no nível de rota, mesmo padrão de `conta/acoes.ts`).
 */
export async function aceitarTermosAction(): Promise<void> {
  const cliente = await clienteDaSessaoAtual();
  await aceitarTermos(cliente.id);
}
