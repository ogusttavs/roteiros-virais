/**
 * Nada fora de src/ia/ importa o SDK da Anthropic direto
 * (plataforma/CLAUDE.md: "Nunca chamar o SDK direto de um servico"; plano de
 * execucao, etapa 4, decisao do Fable). Toda chamada de IA passa por
 * src/ia/cliente.ts.
 */
import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const arquivos = globSync("src/**/*.{ts,tsx}").filter((arquivo) => !arquivo.startsWith("src/ia/"));

describe("nenhum arquivo fora de src/ia/ importa @anthropic-ai/sdk", () => {
  it.each(arquivos)("%s", (arquivo) => {
    const conteudo = readFileSync(arquivo, "utf8");
    expect(conteudo).not.toMatch(/@anthropic-ai\/sdk/);
  });
});
