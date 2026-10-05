import { describe, expect, it } from "vitest";

import { config } from "@/lib/config";

import { coletarResultadosLote, criarLote, montarRequisicaoDoLote, statusLote } from "./lote";
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

describe("montarRequisicaoDoLote (o pedido que vai à API de lote)", () => {
  const base = { customId: "c1", tarefa: "extrairVideo" as const, schema: extrairVideoSchema, sistemaEstavel: "sistema", entrada: "entrada" };

  it("o effort vai só no modelo forte: no barato é ignorado, e sem effort não há campo", () => {
    expect(montarRequisicaoDoLote({ ...base, nivel: "forte", effort: "high" }).params.output_config).toMatchObject({ effort: "high" });
    expect("effort" in montarRequisicaoDoLote({ ...base, nivel: "barato", effort: "high" }).params.output_config).toBe(false);
    expect("effort" in montarRequisicaoDoLote({ ...base, nivel: "forte" }).params.output_config).toBe(false);
  });

  it("o modelo é o do nível, e o limite de tokens é o do item ou o padrão", () => {
    expect(montarRequisicaoDoLote({ ...base, nivel: "forte" }).params.model).toBe(config.ia.modeloForte);
    expect(montarRequisicaoDoLote({ ...base, nivel: "barato", maxTokens: 123 }).params).toMatchObject({ model: config.ia.modeloBarato, max_tokens: 123 });
    expect(montarRequisicaoDoLote({ ...base, nivel: "barato" }).params.max_tokens).toBe(4000);
  });

  it("uma meia-surrogata solta no sistema ou na entrada vira o caractere de substituição (senão a API recusa o lote inteiro com 400)", () => {
    const meia = "\uD83D";
    const pedido = montarRequisicaoDoLote({ ...base, nivel: "barato", sistemaEstavel: `abc${meia}def`, entrada: `legenda cortada ${meia}` });
    expect(pedido.params.system[0].text).toBe("abc\uFFFDdef");
    expect(pedido.params.messages[0].content).toBe("legenda cortada \uFFFD");
    // O texto bom não muda.
    expect(montarRequisicaoDoLote({ ...base, nivel: "barato", entrada: "olá \u{1F600}" }).params.messages[0].content).toBe("olá \u{1F600}");
  });
});
