"use server";

import { revalidatePath } from "next/cache";

import type { ResultadoAcao } from "@/lib/resultado-acao";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { clienteDaSessaoAtual, ErroAcessoNegado, ErroCliente, trocarMarca } from "@/servicos/clientes";
import { criarEmpresaDoGrupo, darAcessoNaEmpresa, ErroConviteDeGrupo, tirarAcessoDaEmpresa } from "@/servicos/convite-de-grupo";
import { textosConviteDeGrupo } from "@/textos/convite-de-grupo";

const t = textosConviteDeGrupo;

async function sessaoOuErro() {
  const sessao = await sessaoDoPainel();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  return sessao;
}

/**
 * "Criar outra empresa" (convite de grupo). A pessoa vem da sessão; o servidor acha o convite dela e recusa quem não é dona de grupo ou já chegou ao máximo. Depois de criar, a empresa
 * nova vira a ativa e a tela leva para o `/comecar`.
 */
export async function criarEmpresaAction(nome: string): Promise<ResultadoAcao<{ clienteId: number }>> {
  const recusa = await recusaDoVerComo();
  if (recusa) return { ok: false, erro: recusa };
  const sessao = await sessaoOuErro();
  try {
    const { clienteId } = await criarEmpresaDoGrupo(sessao.user.id, nome);
    await trocarMarca(sessao.user.id, clienteId);
    revalidatePath("/", "layout");
    return { ok: true, dado: { clienteId } };
  } catch (erro) {
    if (erro instanceof ErroConviteDeGrupo) {
      if (erro.motivo === "cheio") return { ok: false, erro: t.empresas.cheio };
      if (erro.motivo === "nomeInvalido") return { ok: false, erro: t.empresas.nomeInvalido };
      return { ok: false, erro: t.empresas.semPermissao };
    }
    throw erro;
  }
}

/** "Dar acesso": o `clienteId` é SEMPRE o da empresa ativa no servidor, nunca um valor do navegador. A resposta é a mesma para e-mail novo e para e-mail que já tinha conta. */
export async function darAcessoDaEmpresaAction(email: string): Promise<ResultadoAcao<{ mensagem: string }>> {
  const recusa = await recusaDoVerComo();
  if (recusa) return { ok: false, erro: recusa };
  const sessao = await sessaoOuErro();
  const empresa = await clienteDaSessaoAtual();
  try {
    const { email: normalizado } = await darAcessoNaEmpresa(sessao.user.id, empresa.id, email);
    revalidatePath("/conta");
    return { ok: true, dado: { mensagem: t.pessoas.pronto(normalizado) } };
  } catch (erro) {
    if (erro instanceof ErroConviteDeGrupo) {
      if (erro.motivo === "emailInvalido") return { ok: false, erro: t.pessoas.emailInvalido };
      if (erro.motivo === "limite") return { ok: false, erro: t.pessoas.limite };
      return { ok: false, erro: t.pessoas.semPermissao };
    }
    throw erro;
  }
}

/** "Tirar acesso": o dono da empresa ativa tira um membro. O dono nunca sai. */
export async function tirarAcessoDaEmpresaAction(usuarioId: string): Promise<ResultadoAcao<{ mensagem: string }>> {
  const recusa = await recusaDoVerComo();
  if (recusa) return { ok: false, erro: recusa };
  const sessao = await sessaoOuErro();
  const empresa = await clienteDaSessaoAtual();
  try {
    await tirarAcessoDaEmpresa(sessao.user.id, empresa.id, usuarioId);
    revalidatePath("/conta");
    return { ok: true, dado: { mensagem: t.pessoas.removido } };
  } catch (erro) {
    if (erro instanceof ErroConviteDeGrupo) return { ok: false, erro: t.pessoas.semPermissao };
    if (erro instanceof ErroCliente) return { ok: false, erro: erro.message };
    throw erro;
  }
}
