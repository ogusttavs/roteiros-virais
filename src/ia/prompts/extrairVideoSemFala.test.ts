/**
 * Achado 11 da revisão do motor (01/10/2026): o lembrete de acentuação como última linha da
 * entrada. Esta tarefa não tem retentativa nenhuma hoje, então a posição já nasce definitiva.
 */
import { describe, expect, it } from "vitest";

import { montarEntrada, schema } from "./extrairVideoSemFala";

describe("montarEntrada", () => {
  it("o lembrete de acentuacao e a ultima linha da entrada", () => {
    const entrada = montarEntrada({ titulo: "titulo qualquer", legenda: "legenda qualquer", duracaoS: 30, nomeNicho: "nicho", termosNicho: [] });
    expect(entrada.endsWith("acentuação correta do português (você, não, já, também, é, está), mesmo que o título ou a legenda do post estejam sem acento.")).toBe(true);
  });
});

/** M5b, item 2: mesmo conserto de `extrairVideo.ts` (formato fora da lista vira "outro"). */
describe("schema, formato fora da lista vira outro (M5b, item 2)", () => {
  it("formato desconhecido vira outro, sem reprovar a ficha inteira", () => {
    const resultado = schema.safeParse({
      assunto: "assunto",
      gancho: "gancho",
      estrutura: "estrutura",
      fechamento: "fechamento",
      chamadaFinal: "chamada",
      formato: "formato_que_nao_existe",
      porQueFuncionou: "porque",
      etiquetas: [],
      pertenceAoNicho: true,
      motivoNicho: "motivo",
      tipoConteudo: "original",
      serveDeModelo: true,
    });
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.formato).toBe("outro");
  });
});
