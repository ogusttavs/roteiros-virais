/**
 * Nada fora de src/ia/ importa o SDK da Anthropic direto
 * (plataforma/CLAUDE.md: "Nunca chamar o SDK direto de um servico"; plano de
 * execucao, etapa 4, decisao do Fable). Toda chamada de IA passa por
 * src/ia/cliente.ts.
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `globSync` devolve `\` no Windows (achado provando o ambiente no Dell,
 * 09/09/2026, item 0d do PROXIMO.md); `startsWith("src/ia/")` nunca batia e
 * `cliente.ts`/`lote.ts` entravam na lista, cujo conteudo cita
 * `@anthropic-ai/sdk` de verdade e reprovava o teste.
 */
const arquivos = globSync("src/**/*.{ts,tsx}")
  .map((arquivo) => arquivo.split(path.sep).join("/"))
  .filter((arquivo) => !arquivo.startsWith("src/ia/"));

describe("nenhum arquivo fora de src/ia/ importa @anthropic-ai/sdk", () => {
  it.each(arquivos)("%s", (arquivo) => {
    const conteudo = readFileSync(arquivo, "utf8");
    expect(conteudo).not.toMatch(/@anthropic-ai\/sdk/);
  });
});
