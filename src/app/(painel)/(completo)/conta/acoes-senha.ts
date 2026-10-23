"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import type { ResultadoAcao } from "@/lib/resultado-acao";
import { conferirSenhaNova } from "@/lib/senha-regras";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { ErroAcessoNegado } from "@/servicos/clientes";
import { encerrarOutrasSessoes, limparSenhaProvisoria } from "@/servicos/senha";
import { textosSenha } from "@/textos/senha";

/**
 * "Trocar a senha" da Conta (E58): a senha de agora e a nova (o mínimo de 8 vale aqui e no servidor), e as outras sessões da pessoa são encerradas. Quem é a pessoa vem da
 * sessão, nunca de um parâmetro. O `changePassword` do better-auth confere a senha de agora; esta ação só traduz o erro dele em frase e apaga a marca de senha provisória.
 */
export async function trocarSenhaAction(dados: { atual: string; nova: string }): Promise<ResultadoAcao<null>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");

  const problema = conferirSenhaNova(dados.nova);
  if (problema === "curta") return { ok: false, erro: textosSenha.erroCurta };
  if (problema === "longa") return { ok: false, erro: textosSenha.erroLonga };
  if (dados.nova === dados.atual) return { ok: false, erro: textosSenha.conta.igual };

  try {
    await auth.api.changePassword({
      headers: await headers(),
      // Sem `revokeOtherSessions`: ele apaga TODAS as sessoes (a de agora tambem) e cria outra, e o painel, que se refaz na mesma resposta da acao com o cookie velho, mandaria a pessoa para
      // /entrar. As outras sessoes saem logo abaixo, mantendo esta.
      body: { currentPassword: dados.atual, newPassword: dados.nova, revokeOtherSessions: false },
    });
  } catch (erro) {
    if (erro instanceof APIError) {
      const codigo = (erro.body as { code?: string } | undefined)?.code;
      if (codigo === "INVALID_PASSWORD") return { ok: false, erro: textosSenha.conta.atualErrada };
      if (codigo === "PASSWORD_TOO_SHORT") return { ok: false, erro: textosSenha.erroCurta };
      if (codigo === "PASSWORD_TOO_LONG") return { ok: false, erro: textosSenha.erroLonga };
    }
    throw erro;
  }

  await encerrarOutrasSessoes(sessao.user.id, sessao.session.token);
  await limparSenhaProvisoria(sessao.user.id);
  return { ok: true, dado: null };
}
