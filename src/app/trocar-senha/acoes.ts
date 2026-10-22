"use server";

import { redirect } from "next/navigation";

import type { ResultadoAcao } from "@/lib/resultado-acao";
import { sessaoAtual } from "@/lib/sessao";
import { recusaDoVerComo } from "@/lib/ver-como";
import { ErroSenha, trocarSenhaDoPrimeiroAcesso } from "@/servicos/senha";
import { textosSenha } from "@/textos/senha";

/**
 * A troca do primeiro acesso (E58): quem entrou com a senha provisória do convite escolhe a dela. Quem é a pessoa vem da sessão real (`sessaoAtual`), nunca do "ver como": o admin olhando
 * não escolhe a senha de ninguém. O servidor confere que a conta ainda tem a marca de senha provisória e que a nova não é a provisória.
 */
export async function trocarSenhaDoPrimeiroAcessoAction(dados: { nova: string }): Promise<ResultadoAcao<{ destino: string }>> {
  // Com o "ver como" ligado o admin so olha: nada aqui muda a senha de ninguem (e o painel nunca leva a esta tela nesse modo).
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");

  try {
    await trocarSenhaDoPrimeiroAcesso(sessao.user.id, sessao.session.token, dados.nova);
  } catch (erro) {
    if (erro instanceof ErroSenha) {
      if (erro.codigo === "curta") return { ok: false, erro: textosSenha.erroCurta };
      if (erro.codigo === "longa") return { ok: false, erro: textosSenha.erroLonga };
      if (erro.codigo === "igual") return { ok: false, erro: textosSenha.primeiroAcesso.igualProvisoria };
      // "nao_provisoria": ja escolheu a senha (outra aba, ou a tela antiga): segue para o painel.
      if (erro.codigo === "nao_provisoria") return { ok: true, dado: { destino: sessao.user.role === "admin" ? "/admin" : "/hoje" } };
    }
    throw erro;
  }
  return { ok: true, dado: { destino: sessao.user.role === "admin" ? "/admin" : "/hoje" } };
}
