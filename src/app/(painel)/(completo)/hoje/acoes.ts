"use server";

import { sessaoAtual } from "@/lib/sessao";
import { clienteDaSessaoAtual, ErroAcessoNegado, salvarRedePrincipal } from "@/servicos/clientes";
import { roteiroMaisRecenteDesde } from "@/servicos/roteiro";

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

/**
 * R1, item 0c: chamada pela tela de espera quando a geração do roteiro parece ter caído por
 * rede. `desdeMs` é o relógio do aparelho no instante em que a espera começou; `MARGEM_MS`
 * absorve o desencontro normal entre o relógio do aparelho e o do servidor, para não perder um
 * roteiro que de fato terminou (perder por alguns segundos de margem é inofensivo: o próximo
 * roteiro do dia, se existir, é sempre mais recente que a margem).
 */
const MARGEM_RELOGIO_MS = 15_000;

export async function roteiroRecenteDesdeAction(desdeMs: number): Promise<{ id: number } | null> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  return roteiroMaisRecenteDesde(cliente.id, new Date(desdeMs - MARGEM_RELOGIO_MS));
}
