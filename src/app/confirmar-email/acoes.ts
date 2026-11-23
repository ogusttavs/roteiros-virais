"use server";

import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { reenviarConfirmacao } from "@/servicos/cadastro";
import { textosCadastro } from "@/textos/cadastro";

export type ResultadoReenvio = { ok: boolean; frase: string };

/** "Mandar outro link" da página de confirmar o e-mail (E63 PR 1): só manda o e-mail da própria pessoa da sessão, com teto de reenvios. */
export async function reenviarConfirmacaoAction(): Promise<ResultadoReenvio> {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  const t = textosCadastro.confirmeSeuEmail;
  const resultado = await reenviarConfirmacao(sessao.user.id);
  if (resultado.ok) return { ok: true, frase: t.reenviado };
  if (resultado.motivo === "jaConfirmado") return { ok: true, frase: t.jaConfirmado };
  return { ok: false, frase: resultado.motivo === "esperar" ? t.esperar : t.limiteDeReenvios };
}
