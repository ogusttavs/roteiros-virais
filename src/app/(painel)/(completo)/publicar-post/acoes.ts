"use server";

import { revalidatePath } from "next/cache";

import { idDoBancoOuNulo } from "@/lib/id-rota";
import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import type { ResultadoAcao } from "@/lib/resultado-acao";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { cancelarPostPronto, repetirPostPronto, type VistaDoPost } from "@/servicos/post-pronto";
import { fraseDeRecusaDoPost } from "@/textos/post-pronto";

/** Marca e pessoa vêm da sessão, nunca de um parâmetro (isolamento no nível da ação). */
async function quemPublica() {
  const sessao = await sessaoDoPainel();
  if (!sessao) return null;
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  return cliente ? { usuarioId: sessao.user.id, clienteId: cliente.id } : null;
}

/** E56 PR 2: "Tirar da fila". O "ver como" nunca (primeira linha); o portão da cobrança; só o dono (o serviço confere); só da marca da sessão. */
export async function cancelarPostAction(postId: number): Promise<ResultadoAcao<{ vista: VistaDoPost }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) return { ok: false, erro: fraseDeRecusaDoPost("so-dono") };
  await exigirAssinaturaValida();
  const quem = await quemPublica();
  const id = idDoBancoOuNulo(postId);
  if (!quem || id === null) return { ok: false, erro: fraseDeRecusaDoPost("nao-achou") };
  const resultado = await cancelarPostPronto(quem.usuarioId, quem.clienteId, id);
  if (!resultado.ok) return { ok: false, erro: resultado.frase };
  revalidatePath("/publicar-post");
  return { ok: true, dado: { vista: resultado.vista } };
}

/** E56 PR 2: "Pôr na fila de novo", só para o post que falhou sem ter saído. Mesmas regras do cancelar. */
export async function repetirPostAction(postId: number): Promise<ResultadoAcao<{ vista: VistaDoPost }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) return { ok: false, erro: fraseDeRecusaDoPost("so-dono") };
  await exigirAssinaturaValida();
  const quem = await quemPublica();
  const id = idDoBancoOuNulo(postId);
  if (!quem || id === null) return { ok: false, erro: fraseDeRecusaDoPost("nao-achou") };
  const resultado = await repetirPostPronto(quem.usuarioId, quem.clienteId, id);
  if (!resultado.ok) return { ok: false, erro: resultado.frase };
  revalidatePath("/publicar-post");
  return { ok: true, dado: { vista: resultado.vista } };
}
