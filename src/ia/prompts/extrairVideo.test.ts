/**
 * Achado 11 da revisão do motor (01/10/2026): o lembrete de acentuação como última linha da
 * entrada. Esta tarefa roda em lote, sem `gerarComVerificacao`, então a posição já nasce
 * definitiva aqui mesmo.
 */
import { describe, expect, it } from "vitest";

import { montarEntrada } from "./extrairVideo";

describe("montarEntrada", () => {
  it("o lembrete de acentuacao e a ultima linha da entrada", () => {
    const entrada = montarEntrada({ titulo: "titulo qualquer", transcricao: "transcricao qualquer", nomeNicho: "nicho", termosNicho: [] });
    expect(entrada.endsWith("acentuação correta do português (você, não, já, também, é, está), mesmo que a transcrição original esteja em outro idioma ou sem acento.")).toBe(true);
  });
});
