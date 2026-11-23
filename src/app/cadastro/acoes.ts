"use server";

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { cadastrarConta, type ErrosDoCadastro } from "@/servicos/cadastro";
import { textosCadastro } from "@/textos/cadastro";

/** `ok` é igual para e-mail novo e para e-mail que já tinha conta: a tela mostra "confirme o seu e-mail" nos dois casos e nunca revela quem já tem conta. */
export type ResultadoCriarConta = { ok: true; email: string } | { ok: false; erros?: ErrosDoCadastro; erro?: string };

/**
 * O IP de quem pede, só para o limite de pedidos (nunca vai para o banco). Atrás do Caddy, `x-forwarded-for` é o endereço de quem chegou ao Caddy; sem o cabeçalho (desenvolvimento),
 * todos caem na mesma chave.
 */
function ipDoPedido(cabecalhos: Headers): string {
  const encaminhado = cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (encaminhado || cabecalhos.get("x-real-ip")?.trim() || "sem-ip").slice(0, 64);
}

/**
 * "Criar conta" (E63 PR 1). Rota pública: não há sessão. Escolha de desenho: Server Action sobre o serviço `cadastrarConta`, e não o `POST /api/auth/sign-up/email` do better-auth, que
 * continua fechado para o mundo (`disableSignUp`): aquele endpoint não tem as travas (chave, limite por IP, e-mail descartável, termos, marca e dona na mesma transação). Depois de
 * criar, entra na conta pelo `signInEmail` (o `nextCookies` grava o cookie); sem confirmar o e-mail, o painel só mostra "confirme o seu e-mail".
 * Desligada pela chave `CADASTRO_ABERTO`, responde fechado e nada mais acontece.
 */
export async function criarContaAction(dados: unknown): Promise<ResultadoCriarConta> {
  const cabecalhos = await headers();
  const resultado = await cadastrarConta(dados, { ip: ipDoPedido(cabecalhos) });
  if (!resultado.ok) {
    if (resultado.motivo === "campos") return { ok: false, erros: resultado.erros };
    return { ok: false, erro: textosCadastro.erros[resultado.motivo] };
  }
  // Só a conta nova entra (cookie de sessão); a de e-mail que já existia não ganha sessão nenhuma, e o aviso foi por e-mail.
  if (resultado.novo) {
    const senha = (dados as { senha: string }).senha;
    await auth.api.signInEmail({ body: { email: resultado.email, password: senha }, headers: cabecalhos });
  }
  return { ok: true, email: resultado.email };
}
