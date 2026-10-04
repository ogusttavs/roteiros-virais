"use server";

import { revalidatePath } from "next/cache";

import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario, ErroAcessoNegado } from "@/servicos/clientes";
import { ErroFormato, responderFormatosDoCliente } from "@/servicos/formatos";

/**
 * O cliente responde as chaves de formato da marca ativa dele (E44 PR 1; a tela é do PR 2). A marca vem da sessão, nunca de um parâmetro. Devolve `true` quando
 * gravou; uma resposta que não é um mapa de chave para sim ou não volta `false`, sem lançar.
 */
export async function responderFormatosAction(respostas: unknown): Promise<boolean> {
  const sessao = await sessaoAtual();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  if (typeof respostas !== "object" || respostas === null || Array.isArray(respostas)) return false;
  const mapa: Record<string, boolean> = {};
  for (const [chave, valor] of Object.entries(respostas as Record<string, unknown>)) {
    if (typeof valor !== "boolean") return false;
    mapa[chave] = valor;
  }
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) throw new ErroAcessoNegado("Nenhuma marca ativa.");
  try {
    await responderFormatosDoCliente(cliente.id, mapa, sessao.user.id);
  } catch (erro) {
    if (erro instanceof ErroFormato) return false;
    throw erro;
  }
  revalidatePath("/conta");
  return true;
}
