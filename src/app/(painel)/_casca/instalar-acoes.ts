"use server";

import { sessaoAtual } from "@/lib/sessao";
import { adiarConviteDeInstalar, ErroAcessoNegado, registrarInstalacao } from "@/servicos/clientes";

/**
 * O convite de instalar o aplicativo (E48 PR 1). O usuário sempre vem da sessão, nunca de um parâmetro (mesmo padrão de `aceite-acoes.ts`).
 * "Agora não": a folha não volta por sete dias, em nenhum aparelho da pessoa.
 */
export async function adiarConviteDeInstalarAction(): Promise<void> {
  const sessao = await sessaoAtual();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  await adiarConviteDeInstalar(sessao.user.id);
}

/** A primeira abertura em modo aplicativo (tela cheia): grava `instalado_em` uma vez. */
export async function registrarInstalacaoAction(): Promise<void> {
  const sessao = await sessaoAtual();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  await registrarInstalacao(sessao.user.id);
}
