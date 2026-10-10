/**
 * O cadastro por e-mail e senha está fechado (hotfix de segurança, 10/10/2026): "ninguém se cadastra sozinho; o admin cria a conta e dá o acesso". O endpoint do better-auth
 * (`POST /api/auth/sign-up/email`) ficava aberto: quem pré-registrasse o e-mail de uma pessoa virava dono ou membro da marca quando o admin desse acesso àquele e-mail
 * (`darAcesso` procura o usuário pelo e-mail, sem conferir se foi ele quem se cadastrou), e qualquer conta com sessão alcançava as ações que gastam IA sem marca.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";

import { resetarSchema } from "../../scripts/resetar-schema";

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("o cadastro por e-mail e senha", () => {
  it("o endpoint de cadastro recusa, e nenhum usuário nasce", async () => {
    const resposta = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "estranho@exemplo.teste", password: "SenhaDoEstranho123", name: "Estranho" }),
      }),
    );

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toMatchObject({ code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" });
    expect(await db().select().from(user).where(eq(user.email, "estranho@exemplo.teste"))).toHaveLength(0);
  });

  it("a chamada pelo servidor também recusa (o fechamento vale para quem chama a API direto)", async () => {
    await expect(auth.api.signUpEmail({ body: { email: "outro@exemplo.teste", password: "SenhaDoEstranho123", name: "Outro" } })).rejects.toMatchObject({
      body: { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" },
    });
    expect(await db().select().from(user).where(eq(user.email, "outro@exemplo.teste"))).toHaveLength(0);
  });
});
