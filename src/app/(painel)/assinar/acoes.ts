"use server";

import type { ResultadoAcao } from "@/lib/resultado-acao";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { abrirPortalDaAssinatura, assinarAgora, ErroAssinatura, iniciarAssinatura } from "@/servicos/assinatura";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { textosAssinatura } from "@/textos/assinatura";

/**
 * E22 PR 1: começa a assinatura da marca ativa e devolve o endereço do pagamento no Stripe. A marca e a pessoa vêm da sessão, nunca de um parametro (isolamento no nivel de
 * rota); so o dono da marca assina (`iniciarAssinatura`); o "ver como" nunca (primeira linha).
 */
export async function assinarAction(): Promise<ResultadoAcao<{ url: string }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) return { ok: false, erro: textosAssinatura.erroGenerico };
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return { ok: false, erro: textosAssinatura.erroGenerico };
  try {
    return { ok: true, dado: await iniciarAssinatura({ id: sessao.user.id, email: sessao.user.email }, cliente) };
  } catch (erro) {
    if (erro instanceof ErroAssinatura) return { ok: false, erro: erro.message };
    throw erro;
  }
}

/** E22 PR 1: abre o portal do Stripe (trocar o cartao, cancelar). Mesmas regras de `assinarAction`. */
export async function abrirPortalAction(): Promise<ResultadoAcao<{ url: string }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) return { ok: false, erro: textosAssinatura.erroGenerico };
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return { ok: false, erro: textosAssinatura.erroGenerico };
  try {
    return { ok: true, dado: await abrirPortalDaAssinatura({ id: sessao.user.id }, cliente) };
  } catch (erro) {
    if (erro instanceof ErroAssinatura) return { ok: false, erro: erro.message };
    throw erro;
  }
}

/**
 * Assinar no meio do teste (23/11/2026, "cobra na hora"): encerra o teste da marca ativa e cobra o cartão cadastrado. Devolve o endereço para onde a pessoa vai: de volta a `/assinar`
 * (cobrado; a tela espera o aviso do pagamento) ou ao portal para cadastrar o cartão (quando ainda não há). Cartão recusado volta como erro com a frase pronta. É a mesma ação que o botão
 * da tela de assinar usa; a tela do limite do teste (`/limite-do-teste`) deve chamá-la, sem criar outra. Mesmas regras de `assinarAction`: marca e pessoa da sessão, só o dono, nunca o "ver como".
 */
export async function assinarAgoraAction(): Promise<ResultadoAcao<{ url: string }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) return { ok: false, erro: textosAssinatura.erroGenerico };
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return { ok: false, erro: textosAssinatura.erroGenerico };
  try {
    const r = await assinarAgora({ id: sessao.user.id }, cliente);
    return { ok: true, dado: { url: r.tipo === "cobrado" ? "/assinar?assinou=1&agora=1" : r.url } };
  } catch (erro) {
    if (erro instanceof ErroAssinatura) return { ok: false, erro: erro.message };
    throw erro;
  }
}
