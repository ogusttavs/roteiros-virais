import { randomBytes } from "node:crypto";

import { auth } from "@/lib/auth";
import { config } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { textosAuth } from "@/textos/auth";

/** O link do convite vale 48 horas (o do "entrar" comum continua com 15 minutos, em `auth.ts`): quem abre o e-mail à noite ou no dia seguinte ainda consegue entrar. */
export const VALIDADE_DO_CONVITE_EM_SEGUNDOS = 60 * 60 * 48;

/**
 * Como o plugin do link mágico guarda o código em `verification` desde o better-auth 1.7.7: o identificador leva o prefixo `magic-link:` e o valor é
 * `{"type":"magic-link","email":...}`, sem nenhum campo a mais (o plugin confere com um schema estrito). Até a 1.7.6 o identificador era o código puro e o valor só
 * `{"email":...}`; a mudança é a correção do GHSA-965c-763c-88jm (o `state` de um login social valia como link mágico, porque os dois caíam no mesmo identificador).
 * Um convite gravado no formato antigo volta "INVALID_TOKEN" na 1.7.7 em diante; `tests/integracao/convite.test.ts` compara este formato com o do próprio plugin.
 */
export function identificadorDoLinkMagico(token: string): string {
  return `magic-link:${token}`;
}

/**
 * Cria o link do convite: o mesmo valor de verificação do link mágico do better-auth (uso único, o `magicLinkVerify` apaga ao usar; preso ao e-mail dentro do valor;
 * sem usuário com esse e-mail, recusa, porque `disableSignUp` continua ligado), só que com o prazo próprio. O plugin não deixa escolher o prazo por pedido, e aceitar o
 * prazo vindo do corpo de `/sign-in/magic-link` deixaria qualquer um pedir link longo; por isso o valor nasce aqui, no servidor, sem endpoint novo. O formato do valor é
 * o do plugin (ver `identificadorDoLinkMagico`).
 */
export async function gerarLinkDeConvite(email: string): Promise<string> {
  const contexto = await auth.$context;
  const token = randomBytes(24).toString("base64url");
  await contexto.internalAdapter.createVerificationValue({
    identifier: identificadorDoLinkMagico(token),
    value: JSON.stringify({ type: "magic-link", email }),
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
