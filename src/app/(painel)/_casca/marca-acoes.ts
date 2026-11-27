"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { idDoBancoOuNulo } from "@/lib/id-rota";
import { exigirForaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { ErroAcessoNegado, trocarMarca } from "@/servicos/clientes";
import { roteiroPorId } from "@/servicos/roteiro";

/**
 * Para onde a troca leva, de lista fechada (o navegador só escolhe entre estas formas, e o servidor confere): o Hoje, ou um roteiro, aceito só se for da marca para a qual a pessoa está
 * trocando (senão vai para o Hoje). Sem destino, a troca só revalida a tela em que a pessoa está.
 */
export type DestinoDaTroca = "hoje" | { roteiroId: number };

/**
 * Troca a marca ativa da sessao (V3, item 2 e 3): confere que o usuario e
 * membro antes de gravar o cookie (`trocarMarca`, em `src/servicos/clientes.ts`).
 * O usuario sempre vem da sessao, nunca de um parametro. Com `destino`, termina num
 * `redirect` que SUBSTITUI a entrada do histórico (a tela de onde a pessoa trocou não pode
 * ficar para trás nem prender o Voltar); o `redirect` fica fora de qualquer try/catch.
 */
export async function trocarMarcaAction(clienteId: number, destino?: DestinoDaTroca): Promise<void> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  await trocarMarca(sessao.user.id, clienteId);
  revalidatePath("/", "layout");
  if (destino === undefined) return;
  redirect(await caminhoDoDestino(clienteId, destino), RedirectType.replace);
}

async function caminhoDoDestino(clienteId: number, destino: unknown): Promise<string> {
  if (typeof destino === "object" && destino !== null && "roteiroId" in destino) {
    const roteiroId = idDoBancoOuNulo((destino as { roteiroId: unknown }).roteiroId as number);
    if (roteiroId !== null && (await roteiroPorId(roteiroId, clienteId))) return `/roteiros/${roteiroId}`;
  }
  return "/hoje";
}
