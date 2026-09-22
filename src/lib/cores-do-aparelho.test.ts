/** As cores de `cores-do-aparelho.ts` acompanham os tokens (V7, item 5). */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { COR_FUNDO_CLARO, COR_FUNDO_ESCURO } from "./cores-do-aparelho";

const tokens = readFileSync(path.resolve(__dirname, "..", "ui", "tokens.css"), "utf8");

function fundoDoBloco(inicio: string): string | undefined {
  const de = tokens.indexOf(inicio);
  if (de === -1) throw new Error(`bloco nao encontrado: ${inicio}`);
  const bloco = tokens.slice(de, tokens.indexOf("}", de));
  return /--cor-fundo:\s*(#[0-9a-fA-F]{3,8})/.exec(bloco)?.[1]?.toLowerCase();
}

describe("cores do aparelho", () => {
  it("o fundo claro e o token --cor-fundo do tema claro", () => {
    expect(COR_FUNDO_CLARO).toBe(fundoDoBloco('[data-tema="claro"] {'));
  });

  it("o fundo escuro e o token --cor-fundo do tema escuro", () => {
    expect(COR_FUNDO_ESCURO).toBe(fundoDoBloco('[data-tema="escuro"] {'));
  });
});
