"use server";

import type { SistemaInstalado } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado } from "@/servicos/clientes";
import { adiarPedidoDePush, apagarInscricaoDaPessoa, ErroInscricaoPush, registrarInscricaoPush } from "@/servicos/push";

/**
 * O aviso de manhã por push (E48 PR 2). O usuário sempre vem da sessão, nunca de um parâmetro (mesmo padrão de `instalar-acoes.ts`).
 * Devolve `true` quando a inscrição ficou registrada; uma inscrição inválida (endereço que não é https, chaves vazias) volta `false`, sem lançar.
 */
export async function registrarInscricaoPushAction(
  dados: { endpoint: string; p256dh: string; auth: string },
  sistema: string,
): Promise<boolean> {
  const sessao = await sessaoAtual();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  // O aviso é do celular: qualquer coisa que não seja iphone ou android vira computador (e nunca chega aqui pela tela, que só pede no celular).
  const valido: SistemaInstalado = sistema === "iphone" || sistema === "android" ? sistema : "computador";
  try {
    await registrarInscricaoPush(sessao.user.id, dados, valido);
    return true;
  } catch (erro) {
    if (erro instanceof ErroInscricaoPush) return false;
    throw erro;
  }
}

/** A pessoa desliga o aviso neste aparelho (só apaga uma inscrição dela). */
export async function apagarInscricaoPushAction(endpoint: string): Promise<void> {
  const sessao = await sessaoAtual();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  await apagarInscricaoDaPessoa(sessao.user.id, endpoint);
}

/** "Agora não" no pedido de permissão: a folha não volta por sete dias, em nenhum aparelho da pessoa. */
export async function adiarPedidoDePushAction(): Promise<void> {
  const sessao = await sessaoAtual();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  await adiarPedidoDePush(sessao.user.id);
}
