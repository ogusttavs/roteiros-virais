"use server";

import { revalidatePath } from "next/cache";

import { idDoBancoOuNulo } from "@/lib/id-rota";
import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import type { ResultadoAcao } from "@/lib/resultado-acao";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { aprovarEdicao, refazerEdicao } from "@/servicos/edicao-tela";
import { publicarEdicao } from "@/servicos/publicar-edicao";
import { fraseDaEdicao } from "@/textos/edicao";

/** Marca e pessoa vêm da sessão, nunca de um parâmetro (isolamento no nível da ação). */
async function quemEdita() {
  const sessao = await sessaoDoPainel();
  if (!sessao) return null;
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  return cliente ? { usuarioId: sessao.user.id, clienteId: cliente.id } : null;
}

/** "Aprovar": libera o vídeo final. O "ver como" nunca (primeira linha); o portão da cobrança; só uma edição da marca da sessão. */
export async function aprovarEdicaoAction(edicaoId: number): Promise<ResultadoAcao<Record<string, never>>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  await exigirAssinaturaValida();
  const quem = await quemEdita();
  const id = idDoBancoOuNulo(edicaoId);
  if (!quem || id === null) return { ok: false, erro: fraseDaEdicao("nao-achou") };
  const resultado = await aprovarEdicao(quem.clienteId, id);
  return resultado.ok ? { ok: true, dado: {} } : { ok: false, erro: resultado.frase };
}

/** "Refazer com motivo": o pedido entra na próxima decisão. */
export async function refazerEdicaoAction(edicaoId: number, motivo: string): Promise<ResultadoAcao<Record<string, never>>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  await exigirAssinaturaValida();
  const quem = await quemEdita();
  const id = idDoBancoOuNulo(edicaoId);
  if (!quem || id === null) return { ok: false, erro: fraseDaEdicao("nao-achou") };
  const resultado = await refazerEdicao(quem.clienteId, id, motivo);
  return resultado.ok ? { ok: true, dado: {} } : { ok: false, erro: resultado.frase };
}

/** "Publicar no Instagram" com o vídeo editado do servidor. Devolve o número da publicação; a folha de publicar segue perguntando como ela anda (a conferência é a da E56). */
export async function publicarEdicaoAction(edicaoId: number, dados: { tipo: string; legenda: string }): Promise<ResultadoAcao<{ publicacaoId: number }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  await exigirAssinaturaValida();
  const quem = await quemEdita();
  const id = idDoBancoOuNulo(edicaoId);
  if (!quem || id === null) return { ok: false, erro: fraseDaEdicao("nao-achou") };
  const resultado = await publicarEdicao({ usuarioId: quem.usuarioId, clienteId: quem.clienteId, edicaoId: id, tipo: String(dados.tipo), legenda: String(dados.legenda ?? "") });
  if (!resultado.ok) return { ok: false, erro: resultado.frase };
  revalidatePath("/roteiros");
  return { ok: true, dado: { publicacaoId: resultado.publicacaoId } };
}
