"use server";

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import type { ErrosDoCadastro } from "@/servicos/cadastro";
import { trocarMarca } from "@/servicos/clientes";
import { aceitarConviteDeGrupo } from "@/servicos/convite-de-grupo";
import { textosConviteDeGrupo } from "@/textos/convite-de-grupo";

/** `invalido`: o link não vale (mesma resposta para usado, vencido e desativado); a tela troca o formulário pela frase do link inválido. */
export type ResultadoAceiteDoConvite =
  | { ok: true }
  | { ok: false; invalido: true }
  | { ok: false; invalido?: false; erros?: ErrosDoCadastro; erro?: string };

function ipDoPedido(cabecalhos: Headers): string {
  const encaminhado = cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (encaminhado || cabecalhos.get("x-real-ip")?.trim() || "sem-ip").slice(0, 64);
}

/**
 * Aceita o convite de grupo. Rota pública: o código do link é conferido de novo aqui, no servidor (`aceitarConviteDeGrupo`), nunca confiando na página. Depois de criar, entra na conta
 * (`signInEmail`), põe a empresa nova como ativa e a tela leva a pessoa para `/comecar`.
 */
export async function aceitarConviteAction(codigo: string, dados: unknown): Promise<ResultadoAceiteDoConvite> {
  const cabecalhos = await headers();
  const resultado = await aceitarConviteDeGrupo(codigo, dados, { ip: ipDoPedido(cabecalhos) });
  if (!resultado.ok) {
    if (resultado.motivo === "invalido") return { ok: false, invalido: true };
    if (resultado.motivo === "campos") return { ok: false, erros: resultado.erros };
    if (resultado.motivo === "limite") return { ok: false, erro: textosConviteDeGrupo.erros.limite };
    return { ok: false, erro: textosConviteDeGrupo.erros.jaTemConta };
  }
  const senha = (dados as { senha: string }).senha;
  await auth.api.signInEmail({ body: { email: resultado.email, password: senha }, headers: cabecalhos });
  await trocarMarca(resultado.usuarioId, resultado.clienteId);
  return { ok: true };
}
