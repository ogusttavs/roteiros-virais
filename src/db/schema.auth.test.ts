/**
 * Trava o schema do better-auth (user, session, account, verification)
 * contra a versao instalada do pacote. O jeito documentado de gerar esse
 * schema e o @better-auth/cli, mas ele esta travado na versao 1.4.21 no npm
 * enquanto o better-auth principal ja vai na 1.7 (TODO.md, decisoes
 * pendentes). Em vez de arriscar um schema de versao desencontrada, este
 * teste chama getSchema (a mesma funcao que o CLI usa por baixo) com a
 * configuracao real e compara campo a campo com as tabelas do Drizzle. Se
 * uma atualizacao do better-auth acrescentar, remover ou mudar um campo,
 * este teste quebra antes de quebrar em producao.
 *
 * Coluna a mais so entra em COLUNAS_LEGADAS, com o motivo, e precisa ser
 * opcional ou ter padrao: o better-auth nunca a escreve, e desde a 1.7.3 a
 * conferencia que ele roda ao iniciar recusa autenticar quando acha coluna
 * obrigatoria que ele nao escreve. O ultimo bloco roda essa mesma conferencia
 * do pacote contra o schema inteiro passado ao adaptador.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getSchema } from "better-auth/db";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { getTableColumns, type Column } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import * as schemaInteiro from "./schema";
import { account, session, user, verification } from "./schema";

const CONFIGURACAO_REAL = {
  emailAndPassword: { enabled: true },
  plugins: [magicLink({ sendMagicLink: async () => {} }), admin()],
};

/**
 * Colunas que o Drizzle tem e o better-auth instalado nao tem. `account.issuer`
 * veio do better-auth 1.7.0 a 1.7.2 e saiu do pacote na 1.7.3; ficou no banco
 * ate a migracao que a torna opcional ou a apaga (ver o comentario dela em
 * schema.ts).
 */
const COLUNAS_LEGADAS: Record<string, string[]> = {
  account: ["issuer"],
};

/** better-auth chama de "type"; Drizzle chama de "dataType". */
const TIPOS_EQUIVALENTES: Record<string, string> = {
  string: "string",
  boolean: "boolean",
  date: "date",
  number: "number",
};

const TABELAS: Record<string, ReturnType<typeof getTableColumns>> = {
  user: getTableColumns(user),
  session: getTableColumns(session),
  account: getTableColumns(account),
  verification: getTableColumns(verification),
};

describe("schema do better-auth bate com a versao instalada", () => {
  const schemaEsperado = getSchema(CONFIGURACAO_REAL);

  for (const [nomeTabela, definicao] of Object.entries(schemaEsperado)) {
    describe(`tabela "${nomeTabela}"`, () => {
      const colunas = TABELAS[nomeTabela];

      it("existe em src/db/schema.ts", () => {
        expect(colunas, `tabela "${nomeTabela}" nao existe no Drizzle`).toBeDefined();
      });

      if (!colunas) return;

      const camposEsperados = Object.entries(definicao.fields);
      const camposReais = Object.fromEntries(
        Object.entries(colunas).filter(([chave]) => chave !== "id"),
      ) as Record<string, Column>;

      for (const [campo, atributo] of camposEsperados) {
        it(`campo "${campo}" existe com o tipo e a obrigatoriedade certos`, () => {
          const coluna = camposReais[campo];
          expect(coluna, `campo "${campo}" nao existe na tabela "${nomeTabela}"`).toBeDefined();
          if (!coluna) return;

          expect(TIPOS_EQUIVALENTES[atributo.type as string]).toBe(coluna.dataType);
          expect(coluna.notNull).toBe(Boolean(atributo.required));
        });
      }

      it("nao tem coluna a mais (fora id e as legadas)", () => {
        const nomesEsperados = new Set(camposEsperados.map(([campo]) => campo));
        const legadas = new Set(COLUNAS_LEGADAS[nomeTabela] ?? []);
        const extras = Object.keys(camposReais).filter(
          (campo) => !nomesEsperados.has(campo) && !legadas.has(campo),
        );
        expect(extras).toEqual([]);
      });

      for (const campo of COLUNAS_LEGADAS[nomeTabela] ?? []) {
        it(`coluna legada "${campo}" existe e o better-auth consegue gravar sem ela`, () => {
          const coluna = camposReais[campo];
          expect(
            coluna,
            `coluna legada "${campo}" saiu da tabela "${nomeTabela}"; tire-a de COLUNAS_LEGADAS`,
          ).toBeDefined();
          if (!coluna) return;
          expect(
            !coluna.notNull || coluna.hasDefault,
            `coluna "${campo}" e obrigatoria e sem padrao`,
          ).toBe(true);
        });
      }
    });
  }
});

/**
 * A conferência que o better-auth roda antes de todo pedido desde a 1.7.3 (`advanced.database.validateSchema`, ligada por padrão, inclusive em produção): com o
 * adaptador do Drizzle ela lê o objeto de schema passado a `drizzleAdapter`, sem consultar o banco, e recusa autenticar se achar coluna obrigatória que o pacote nunca
 * escreve. O banco de mentira (`drizzle.mock()`) basta, porque nada aqui faz consulta. O schema é o módulo inteiro, igual ao de `src/lib/auth.ts`.
 */
async function contextoComOSchema() {
  const instancia = betterAuth({
    ...CONFIGURACAO_REAL,
    baseURL: "http://localhost:3000",
    secret: "segredo-so-do-teste-com-mais-de-trinta-e-dois-caracteres",
    database: drizzleAdapter(drizzle.mock(), { provider: "pg", schema: schemaInteiro }),
  });
  return instancia.$context;
}

describe("a conferencia do schema que o better-auth roda antes de cada pedido", () => {
  it("existe e aceita o schema inteiro do Drizzle", async () => {
    const contexto = await contextoComOSchema();
    expect(
      contexto.checkSchema,
      "o pacote deixou de registrar a conferencia do Drizzle; reveja este teste",
    ).toBeTypeOf("function");
    await expect(Promise.resolve(contexto.checkSchema?.())).resolves.toBeUndefined();
  });

  it("recusa a coluna legada obrigatoria sem padrao (o issuer como estava antes do $defaultFn)", async () => {
    const coluna = getTableColumns(account).issuer as { hasDefault: boolean };
    const original = coluna.hasDefault;
    coluna.hasDefault = false;
    try {
      const contexto = await contextoComOSchema();
      await expect(Promise.resolve(contexto.checkSchema?.())).rejects.toThrow(/issuer/);
    } finally {
      coluna.hasDefault = original;
    }
  });
});
