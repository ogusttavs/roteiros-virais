"use server";

import type { ResultadoAcao } from "@/lib/resultado-acao";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { abrirPortalDaAssinatura, ErroAssinatura, iniciarAssinatura } from "@/servicos/assinatura";
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
