"use server";

import { sessaoAtual } from "@/lib/sessao";
import { clienteDaSessaoAtual, ErroAcessoNegado, salvarRedePrincipal } from "@/servicos/clientes";

/**
 * A rede principal da marca (V12, item 3a): trocável a qualquer hora pelo
 * chip na porta Reels, mesma sessão sempre resolvendo a marca, nunca um
 * `clienteId` vindo do navegador.
 */
export async function salvarRedePrincipalAction(rede: string): Promise<void> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  await salvarRedePrincipal(cliente.id, rede);
}
