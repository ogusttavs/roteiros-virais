/**
 * criarAdmin (etapa 13, fechamento): cria o usuario e a conta de credencial
 * quando o e-mail nao existe; e idempotente quando existe.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "../src/db";
import { account, user } from "../src/db/schema";

import { criarAdmin } from "./criar-admin";
import { resetarSchema } from "./resetar-schema";

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("criarAdmin", () => {
  it("cria o usuario admin e a conta de credencial quando o e-mail nao existe", async () => {
    const resultado = await criarAdmin(db(), {
      email: "admin-teste@exemplo.teste",
      nome: "[teste] Administrador",
      senha: "SenhaDeTeste123",
    });

    expect(resultado.criado).toBe(true);

    const [linha] = await db().select().from(user).where(eq(user.email, "admin-teste@exemplo.teste"));
    expect(linha.role).toBe("admin");
    expect(linha.emailVerified).toBe(true);

    const [conta] = await db().select().from(account).where(eq(account.userId, linha.id));
    expect(conta.providerId).toBe("credential");
    expect(conta.issuer).toBe("local:credential");
    expect(conta.password).toBeTruthy();
  });

  it("nao cria de novo quando o e-mail ja existe (idempotente)", async () => {
    await criarAdmin(db(), {
      email: "admin-repetido@exemplo.teste",
      nome: "[teste] Administrador",
      senha: "SenhaDeTeste123",
    });

    const resultado = await criarAdmin(db(), {
      email: "admin-repetido@exemplo.teste",
      nome: "[teste] Administrador outro nome",
      senha: "OutraSenha456",
    });

    expect(resultado.criado).toBe(false);

    const linhas = await db().select().from(user).where(eq(user.email, "admin-repetido@exemplo.teste"));
    expect(linhas).toHaveLength(1);
  });
});
