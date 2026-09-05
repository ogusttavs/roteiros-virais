import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";

import { db } from "@/db";
import * as schema from "@/db/schema";
import { config } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
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
  },
  /**
   * `enabled: undefined` preserva o padrão do pacote (ligado só em
   * produção); `false` só quando `config.auth.desabilitarLimiteDeTaxa` for
   * setada, e só a suíte e2e faz isso (ver o comentário em `config.ts`).
   */
  rateLimit: {
    enabled: config.auth.desabilitarLimiteDeTaxa ? false : undefined,
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
