import { randomBytes } from "node:crypto";

import { auth } from "@/lib/auth";
import { config } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { textosAuth } from "@/textos/auth";

/** O link do convite vale 48 horas (o do "entrar" comum continua com 15 minutos, em `auth.ts`): quem abre o e-mail à noite ou no dia seguinte ainda consegue entrar. */
export const VALIDADE_DO_CONVITE_EM_SEGUNDOS = 60 * 60 * 48;

/**
 * Cria o link do convite: o mesmo valor de verificação do link mágico do better-auth (uso único, o `magicLinkVerify` apaga ao usar; preso ao e-mail dentro do valor;
 * sem usuário com esse e-mail, recusa, porque `disableSignUp` continua ligado), só que com o prazo próprio. O plugin não deixa escolher o prazo por pedido, e aceitar o
 * prazo vindo do corpo de `/sign-in/magic-link` deixaria qualquer um pedir link longo; por isso o valor nasce aqui, no servidor, sem endpoint novo.
 */
export async function gerarLinkDeConvite(email: string): Promise<string> {
  const contexto = await auth.$context;
  const token = randomBytes(24).toString("base64url");
  await contexto.internalAdapter.createVerificationValue({
    identifier: token,
    value: JSON.stringify({ email }),
    expiresAt: new Date(Date.now() + VALIDADE_DO_CONVITE_EM_SEGUNDOS * 1000),
  });
  const url = new URL("/api/auth/magic-link/verify", config.auth.url);
  url.searchParams.set("token", token);
  url.searchParams.set("callbackURL", "/comecar");
  return url.toString();
}

/** Manda o e-mail de boas-vindas com o link de 48 horas. `nome` é nulo quando o admin não soube o nome. */
export async function mandarEmailDeConvite(email: string, nome: string | null): Promise<void> {
  const url = await gerarLinkDeConvite(email);
  await enviarEmail({
    para: email,
    assunto: textosAuth.assuntoConvite,
    html: textosAuth.corpoConvite({ url, nome, entrarUrl: `${config.appUrl}/entrar` }),
  });
}
