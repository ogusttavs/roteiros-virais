/**
 * `worker.ts` chama `main()` no topo e por isso nenhum teste o importa; esquecer o `boss().work(...)`
 * de uma fila nova deixa os jobs parados para sempre, sem erro e sem teste vermelho (achado do
 * levantamento do PR 2 da E38). Este teste lê o texto do arquivo e confere que toda fila de `FILAS`
 * tem um `.work(` no worker (uma fila sem trabalhador acumula jobs que nunca rodam).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FILAS } from "./fila";

/** Sem comentários: um `.work(` dentro de um comentário não registra nada, e o regex o casaria. */
const TEXTO_DO_WORKER = readFileSync(join(__dirname, "worker.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("worker.ts", () => {
  it("toda fila de FILAS tem um boss().work no worker", () => {
    for (const [chave, nome] of Object.entries(FILAS)) {
      const registrada = new RegExp(`\\.work(?:<[^>]*>)?\\(\\s*FILAS\\.${chave}\\b`).test(TEXTO_DO_WORKER);
      expect(registrada, `o worker nao registra a fila "${nome}" (FILAS.${chave})`).toBe(true);
    }
  });

  it("o handler da fila entender-marca usa o tratador testado, com o nome da própria fila", () => {
    expect(TEXTO_DO_WORKER).toContain("tratarJobEntenderMarca(job, FILAS.entenderMarca)");
  });
});
