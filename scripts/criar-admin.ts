/**
 * npm run admin:criar: cria o primeiro admin em producao, onde ninguem se
 * cadastra sozinho (deploy/README.md, "Primeiro deploy"). Le ADMIN_EMAIL,
 * ADMIN_NOME e ADMIN_SENHA do ambiente, nunca de argumento de linha de
 * comando, para a senha nao ficar no historico do shell. Mesma forma de
 * gravar que criarUsuarioComSenha em semear.ts: user mais account com
 * providerId "credential" e issuer "local:credential", senha por
 * hashPassword do better-auth. Idempotente: e-mail que ja existe nao cria
 * de novo.
 */
import { randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db, getPool, type Db } from "../src/db";
import { account, user } from "../src/db/schema";

export async function criarAdmin(
  bancoDeDados: Db,
  dados: { email: string; nome: string; senha: string },
): Promise<{ criado: boolean }> {
  const [existente] = await bancoDeDados.select({ id: user.id }).from(user).where(eq(user.email, dados.email));
  if (existente) return { criado: false };

  const id = randomUUID();
  await bancoDeDados.insert(user).values({
    id,
    name: dados.nome,
    email: dados.email,
    emailVerified: true,
    role: "admin",
  });
  await bancoDeDados.insert(account).values({
    id: `${id}-credential`,
    issuer: "local:credential",
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await hashPassword(dados.senha),
  });
  return { criado: true };
}

function variavelObrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} nao definida no ambiente.`);
  return valor;
}

async function main(): Promise<void> {
  const email = variavelObrigatoria("ADMIN_EMAIL");
  const nome = variavelObrigatoria("ADMIN_NOME");
  const senha = variavelObrigatoria("ADMIN_SENHA");

  const resultado = await criarAdmin(db(), { email, nome, senha });
  console.log(resultado.criado ? `admin criado: ${email}` : `ja existe: ${email}`);
}

/**
 * O Vitest importa este arquivo para testar criarAdmin (criar-admin.test.ts)
 * sem passar ADMIN_EMAIL/ADMIN_NOME/ADMIN_SENHA; sem essa guarda, so o
 * import ja disparava main() e derrubava o pool no meio do teste (mesmo
 * problema que levou desligamento.ts a existir separado de worker.ts).
 * process.env.VITEST e posto pelo proprio Vitest em todo teste.
 */
if (!process.env.VITEST) {
  main()
    .then(async () => {
      await getPool().end();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error("Falha ao criar admin:", e);
      await getPool().end();
      process.exit(1);
    });
}
