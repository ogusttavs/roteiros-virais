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
const semComentarios = (arquivo: string) =>
  readFileSync(join(__dirname, arquivo), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const TEXTO_DO_WORKER = semComentarios("worker.ts");
const TEXTO_DO_RENDER = semComentarios("worker-render.ts");

/** As filas que o worker comum NÃO consome: o contêiner de render (`worker-render.ts`, 1 vCPU, um vídeo por vez) é o único que as registra. */
const FILAS_DO_RENDER: string[] = ["renderizarEdicao"];

describe("worker.ts", () => {
  it("toda fila de FILAS tem um boss().work no worker", () => {
    for (const [chave, nome] of Object.entries(FILAS)) {
      if (FILAS_DO_RENDER.includes(chave)) continue;
      const registrada = new RegExp(`\\.work(?:<[^>]*>)?\\(\\s*FILAS\\.${chave}\\b`).test(TEXTO_DO_WORKER);
      expect(registrada, `o worker nao registra a fila "${nome}" (FILAS.${chave})`).toBe(true);
    }
  });

  it("a fila do render só tem trabalhador no contêiner de render, e o worker comum nunca a consome", () => {
    for (const chave of FILAS_DO_RENDER) {
      expect(new RegExp(`\\.work(?:<[^>]*>)?\\(\\s*FILAS\\.${chave}\\b`).test(TEXTO_DO_RENDER), `worker-render.ts nao registra FILAS.${chave}`).toBe(true);
      expect(TEXTO_DO_WORKER).not.toContain(`FILAS.${chave}`);
    }
    // Um vídeo por vez: o ffmpeg ocupa o 1 vCPU inteiro do contêiner.
    expect(TEXTO_DO_RENDER).toMatch(/localConcurrency:\s*1/);
    expect(TEXTO_DO_RENDER).toMatch(/batchSize:\s*1/);
  });

  it("o handler da fila entender-marca usa o tratador testado, com o nome da própria fila", () => {
    expect(TEXTO_DO_WORKER).toContain("tratarJobEntenderMarca(job, FILAS.entenderMarca)");
  });
});
