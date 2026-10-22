import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";

import { db } from "@/db";
import * as schema from "@/db/schema";
import { config } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { logger } from "@/lib/log";
import { SENHA_MAXIMO, SENHA_MINIMO } from "@/lib/senha-regras";
import {
  aposRedefinirSenha,
  contarPedidosDeRedefinicaoRecentes,
  LIMITE_DE_PEDIDOS_DE_REDEFINICAO,
  VALIDADE_DO_LINK_EM_SEGUNDOS,
} from "@/servicos/senha";
import { textosAuth } from "@/textos/auth";

/**
 * src/db/schema.auth.test.ts trava o schema das tabelas do better-auth
 * contra getSchema desta mesma configuracao (emailAndPassword, magicLink,
 * admin), entao qualquer mudanca aqui que acrescente ou remova campo tem que
 * entrar no schema tambem.
 */
export const auth = betterAuth({
  baseURL: config.auth.url,
  secret: config.auth.secret,
  database: drizzleAdapter(db(), { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    /**
     * Ninguém se cadastra sozinho (o admin cria a conta e dá o acesso; a criação é por insert direto, `criarUsuarioComSenhaGerada`, não por este endpoint). Sem isto o
     * `POST /api/auth/sign-up/email` ficava aberto: um estranho com e-mail pré-registrado virava o dono da marca quando o admin desse acesso àquele e-mail, e qualquer
     * conta com sessão alcançava as ações que gastam IA sem marca. O mesmo `disableSignUp` do link mágico, logo abaixo.
     */
    disableSignUp: true,
    minPasswordLength: SENHA_MINIMO,
    maxPasswordLength: SENHA_MAXIMO,
    /**
     * "Esqueci a senha" (E58): o link vale 30 minutos e so uma vez (o better-auth apaga o valor ao usar). O e-mail sai pelo `enviarEmail` de sempre, entao o remetente e o
     * `EMAIL_FROM` (producao: o endereco de avisos) e, fora de producao e no e2e, o texto cai no log em vez de sair de verdade.
     */
    resetPasswordTokenExpiresIn: VALIDADE_DO_LINK_EM_SEGUNDOS,
    sendResetPassword: async ({ user, url }) => {
      /**
       * A resposta da tela e a mesma exista ou nao a conta (o better-auth ja responde igual quando o e-mail nao e de ninguem). Aqui duas coisas a mais: (1) um teto de
       * pedidos por pessoa na janela de validade, para ninguem usar a tela para encher a caixa de entrada de outra pessoa, e que vale tambem para quem chama a API direto;
       * (2) o envio nao e esperado, para a resposta de quem tem conta nao demorar mais que a de quem nao tem (o tempo tambem contaria).
       */
      if ((await contarPedidosDeRedefinicaoRecentes(user.id)) > LIMITE_DE_PEDIDOS_DE_REDEFINICAO) {
        logger.warn({ usuarioId: user.id }, "pedido de redefinicao de senha acima do limite; o e-mail nao saiu");
        return;
      }
      void enviarEmail({
        para: user.email,
        assunto: textosAuth.assuntoRedefinirSenha,
        html: textosAuth.corpoRedefinirSenha(url),
      }).catch((erro: unknown) => {
        logger.error({ err: erro, usuarioId: user.id }, "o e-mail de redefinicao de senha nao saiu");
      });
    },
    /** Escolher a senha por este caminho tambem encerra a provisoria, os outros links pedidos e todas as sessoes abertas (quem esqueceu pode ter deixado uma aberta em qualquer lugar). */
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }) => {
      await aposRedefinirSenha(user.id);
    },
  },
  /**
   * `enabled: undefined` preserva o padrão do pacote (ligado só em
   * produção); `false` só em `config.modoE2E`, e só a suíte e2e liga essa
   * flag (ver o comentário em `config.ts`).
   */
  rateLimit: {
    enabled: config.modoE2E ? false : undefined,
    /**
     * Pedir o link de "esqueci a senha" e usar o link tem teto proprio por IP, mais apertado que o padrao do pacote (E58). O teto por pessoa fica em `sendResetPassword`.
     */
    customRules: {
      "/request-password-reset": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 5 },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
  },
  plugins: [
    magicLink({
      expiresIn: 60 * 15,
      /** Ninguem se cadastra sozinho; o admin cria o cliente e convida. */
      disableSignUp: true,
      sendMagicLink: async ({ email, url }) => {
        await enviarEmail({
          para: email,
          assunto: textosAuth.assuntoLinkMagico,
          html: textosAuth.corpoLinkMagico(url),
        });
      },
    }),
    admin({ defaultRole: "cliente" }),
    /** Tem que ser o ultimo plugin, para Server Actions gravarem o cookie certo. */
    nextCookies(),
  ],
});
