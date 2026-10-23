"use server";

import { revalidatePath } from "next/cache";

import type { ResultadoAcao } from "@/lib/resultado-acao";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { desligarConta, escolherConta } from "@/servicos/conta-conectada";
import { textosLigacao } from "@/textos/conta-conectada";

/**
 * E19 PR 1: desligar o Instagram ligado. Marca e pessoa vêm da sessão, nunca de um parâmetro (isolamento no nível de rota); só o dono desliga (`desligarConta`); o "ver como" nunca
 * (primeira linha). Apaga a linha inteira, o token junto. A tela é do PR 2; a ação já existe e é testada aqui.
 */
export async function desligarInstagramAction(): Promise<ResultadoAcao<{ apagadas: number }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) return { ok: false, erro: textosLigacao.retorno["sem-acesso"] };
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return { ok: false, erro: textosLigacao.retorno["sem-acesso"] };
  const resultado = await desligarConta(sessao.user.id, cliente.id);
  if (!resultado.ok) return { ok: false, erro: textosLigacao.retorno["sem-acesso"] };
  revalidatePath("/conta");
  return { ok: true, dado: { apagadas: resultado.apagadas } };
}

/** E19 PR 1: a pessoa escolheu qual das contas do Instagram devolvidas pela Meta é a dela (só quando a Meta devolveu mais de uma). Mesmas regras de `desligarInstagramAction`. */
export async function escolherInstagramAction(contaId: string): Promise<ResultadoAcao<{ contaId: string }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) return { ok: false, erro: textosLigacao.retorno["sem-acesso"] };
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return { ok: false, erro: textosLigacao.retorno["sem-acesso"] };
  const { resultado } = await escolherConta(sessao.user.id, cliente.id, String(contaId));
  if (resultado !== "ligada") return { ok: false, erro: textosLigacao.retorno[resultado] };
  revalidatePath("/conta");
  return { ok: true, dado: { contaId } };
}
