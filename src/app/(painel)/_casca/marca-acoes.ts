"use server";

import { revalidatePath } from "next/cache";

import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado, trocarMarca } from "@/servicos/clientes";

/**
 * Troca a marca ativa da sessao (V3, item 2 e 3): confere que o usuario e
 * membro antes de gravar o cookie (`trocarMarca`, em `src/servicos/clientes.ts`).
 * O usuario sempre vem da sessao, nunca de um parametro.
 */
export async function trocarMarcaAction(clienteId: number): Promise<void> {
  const sessao = await sessaoAtual();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  await trocarMarca(sessao.user.id, clienteId);
  revalidatePath("/", "layout");
}
