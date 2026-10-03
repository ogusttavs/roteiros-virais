"use server";

import type { SistemaInstalado } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado } from "@/servicos/clientes";
import { adiarPedidoDePush, apagarInscricaoDaPessoa, ErroInscricaoPush, registrarInscricaoPush } from "@/servicos/push";

function textoNaoVazio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

/**
 * O aviso de manhã por push (E48 PR 2). O usuário sempre vem da sessão, nunca de um parâmetro (mesmo padrão de `instalar-acoes.ts`).
 * Devolve `true` quando a inscrição ficou registrada; uma inscrição inválida (endereço que não é https, chaves vazias) volta `false`, sem lançar.
 */
export async function registrarInscricaoPushAction(dados: unknown, sistema: unknown): Promise<boolean> {
  const sessao = await sessaoAtual();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  // Os argumentos vêm do navegador: só strings não vazias valem (qualquer outra coisa devolve `false`, sem lançar).
  const entrada = dados as { endpoint?: unknown; p256dh?: unknown; auth?: unknown } | null;
  if (
    typeof entrada !== "object" ||
    entrada === null ||
    !textoNaoVazio(entrada.endpoint) ||
    !textoNaoVazio(entrada.p256dh) ||
    !textoNaoVazio(entrada.auth) ||
    !textoNaoVazio(sistema)
  ) {
    return false;
  }
  // O aviso é do celular: qualquer coisa que não seja iphone ou android vira computador (e nunca chega aqui pela tela, que só pede no celular).
  const valido: SistemaInstalado = sistema === "iphone" || sistema === "android" ? sistema : "computador";
  try {
    await registrarInscricaoPush(sessao.user.id, { endpoint: entrada.endpoint, p256dh: entrada.p256dh, auth: entrada.auth }, valido);
    return true;
  } catch (erro) {
    if (erro instanceof ErroInscricaoPush) return false;
    throw erro;
  }
}

/** A pessoa desliga o aviso neste aparelho (só apaga uma inscrição dela). */
export async function apagarInscricaoPushAction(endpoint: unknown): Promise<void> {
  const sessao = await sessaoAtual();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  if (!textoNaoVazio(endpoint)) return;
  await apagarInscricaoDaPessoa(sessao.user.id, endpoint);
}

/** "Agora não" no pedido de permissão: a folha não volta por sete dias, em nenhum aparelho da pessoa. */
export async function adiarPedidoDePushAction(): Promise<void> {
  const sessao = await sessaoAtual();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  await adiarPedidoDePush(sessao.user.id);
}
