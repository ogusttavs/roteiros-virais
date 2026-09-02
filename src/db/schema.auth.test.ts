/**
 * Trava o schema do better-auth (user, session, account, verification)
 * contra a versao instalada do pacote. O jeito documentado de gerar esse
 * schema e o @better-auth/cli, mas ele esta travado na versao 1.4.21 no npm
 * enquanto o better-auth principal ja vai na 1.7.2 (TODO.md, decisoes
 * pendentes). Em vez de arriscar um schema de versao desencontrada, este
 * teste chama getSchema (a mesma funcao que o CLI usa por baixo) com a
 * configuracao real e compara campo a campo com as tabelas do Drizzle. Se
 * uma atualizacao do better-auth acrescentar, remover ou mudar um campo,
 * este teste quebra antes de quebrar em producao.
 */
import { getSchema } from "better-auth/db";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { getTableColumns, type Column } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { account, session, user, verification } from "./schema";

const CONFIGURACAO_REAL = {
  emailAndPassword: { enabled: true },
  plugins: [magicLink({ sendMagicLink: async () => {} }), admin()],
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

      it("nao tem coluna a mais (fora id)", () => {
        const nomesEsperados = new Set(camposEsperados.map(([campo]) => campo));
        const extras = Object.keys(camposReais).filter((campo) => !nomesEsperados.has(campo));
        expect(extras).toEqual([]);
      });
    });
  }
});
