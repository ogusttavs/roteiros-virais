import { describe, expect, it } from "vitest";

import { coletarResultadosLote, criarLote, statusLote } from "./lote";
import { schema as extrairVideoSchema } from "./prompts/extrairVideo";

describe("lote (mock)", () => {
  it("cria um lote, confere o status e coleta resultados validos pelo schema", async () => {
    const loteId = await criarLote([
      {
        customId: "video-1",
        tarefa: "extrairVideo",
        nivel: "barato",
        schema: extrairVideoSchema,
        sistemaEstavel: "sistema",
        entrada: "Titulo: como clarear os dentes\n\nTranscricao: oi gente",
      },
      {
        customId: "video-2",
        tarefa: "extrairVideo",
        nivel: "barato",
        schema: extrairVideoSchema,
        sistemaEstavel: "sistema",
        entrada: "Titulo: dor de dente\n\nTranscricao: oi de novo",
      },
    ]);

    expect(await statusLote(loteId)).toBe("concluido");

    const resultados = await coletarResultadosLote(loteId, extrairVideoSchema);
    expect(resultados).toHaveLength(2);
    expect(resultados.map((r) => r.customId).sort()).toEqual(["video-1", "video-2"]);
    for (const resultado of resultados) {
      expect(resultado.status).toBe("sucesso");
    }
  });

  it("um lote desconhecido devolve lista vazia", async () => {
    const resultados = await coletarResultadosLote("lote-que-nao-existe", extrairVideoSchema);
    expect(resultados).toEqual([]);
  });
});
