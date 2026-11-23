"use server";

import { sessaoAtual } from "@/lib/sessao";
import { reenviarConfirmacao, trocarEmailDoCadastro } from "@/servicos/cadastro";
import { textosCadastro } from "@/textos/cadastro";

export type ResultadoReenvio = { ok: boolean; frase: string };

/**
 * "Mandar de novo" (E63): só manda o e-mail da própria pessoa da sessão, com teto de reenvios. Sem sessão (quem se cadastrou com um e-mail que já tinha conta não ganha sessão) a
 * resposta é a mesma de quem mandou: a tela nunca revela se o e-mail tem conta, e nada é enviado.
 */
export async function reenviarConfirmacaoAction(): Promise<ResultadoReenvio> {
  const t = textosCadastro.confirmeSeuEmail;
  const sessao = await sessaoAtual();
  if (!sessao) return { ok: true, frase: t.reenviado };
  const resultado = await reenviarConfirmacao(sessao.user.id);
  if (resultado.ok) return { ok: true, frase: t.reenviado };
  if (resultado.motivo === "jaConfirmado") return { ok: true, frase: t.jaConfirmado };
  return { ok: false, frase: resultado.motivo === "esperar" ? t.esperar : t.limiteDeReenvios };
}

/** `campo` é uma frase que vai embaixo do campo de e-mail; `frase` é a geral. */
export type ResultadoTroca = { ok: true; email: string } | { ok: false; campo?: string; frase?: string };

/**
 * "Trocar o e-mail" e "Mandar outro link" do link vencido (E63): o endereço certo recebe o link novo e o link do endereço errado deixa de valer. Sem sessão, a resposta é a de quem
 * mandou e nada acontece (a mesma regra de não revelar quem tem conta).
 */
export async function trocarEmailAction(email: unknown): Promise<ResultadoTroca> {
  const t = textosCadastro.confirmeSeuEmail;
  const texto = typeof email === "string" ? email.trim().slice(0, 254) : "";
  const sessao = await sessaoAtual();
  if (!sessao) return { ok: true, email: texto };
  const resultado = await trocarEmailDoCadastro(sessao.user.id, texto);
  if (resultado.ok) return { ok: true, email: texto.toLowerCase() };
  switch (resultado.motivo) {
    case "email":
      return { ok: false, campo: textosCadastro.erros.email };
    case "descartavel":
      return { ok: false, campo: textosCadastro.erros.emailDescartavel };
    case "jaConfirmado":
      return { ok: false, frase: t.jaConfirmado };
    case "esperar":
      return { ok: false, frase: t.esperar };
    default:
      return { ok: false, frase: t.limiteDeReenvios };
  }
}
