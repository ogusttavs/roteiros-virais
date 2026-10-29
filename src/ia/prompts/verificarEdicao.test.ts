import { describe, expect, it } from "vitest";

import { encontrarProblemas } from "@/lib/regras-de-texto";

import { esforco, montarEntrada, montarSistemaEstavel, nivel, schema, versao } from "./verificarEdicao";

const roteiro = { titulo: "T", gancho: "G", corpo: "C", fechamento: "F", chamadaFinal: "CF" };

describe("verificarEdicao (prompt)", () => {
  it("é versionado e barato", () => {
    expect(versao).toMatch(/^\d+\.\d+\.\d+$/);
    expect(nivel).toBe("barato");
    expect(esforco).toBeUndefined();
    expect(encontrarProblemas(montarSistemaEstavel())).toEqual([]);
  });

  it("a entrada numera os blocos da legenda a partir de 1 e traz título, subtítulo e nomes", () => {
    const e = montarEntrada({ nomesParaGrafar: ["Dr.Wash"], resumoDaMarca: "Limpeza.", roteiro, blocosDaLegenda: ["USE O", "DR.WASH"], titulo: { texto: "Por que volta?", subtitulo: null } });
    expect(e).toContain("1: USE O");
    expect(e).toContain("2: DR.WASH");
    expect(e).toContain("Título: Por que volta?");
    expect(e).toContain("Subtítulo: (nenhum)");
    expect(e).toContain("Dr.Wash");
  });

  it("o schema separa o que reprova do que só avisa", () => {
    const p = { onde: "legenda", bloco: 2, tipo: "nome_errado", gravidade: "reprova", descricao: "d", sugestao: "Dr.Wash" };
    expect(schema.safeParse({ problemas: [p] }).success).toBe(true);
    expect(schema.safeParse({ problemas: [{ ...p, gravidade: "talvez" }] }).success).toBe(false);
    expect(schema.safeParse({ problemas: [] }).success).toBe(true);
  });
});
