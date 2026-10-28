import { describe, expect, it } from "vitest";

import { estadoDoFoco, focoConfirmado, focoParaATela, limparFoco, problemasDaSugestao, TAMANHO_MAXIMO_DO_FOCO } from "./foco-da-conta";

const CONFIRMADO_EM = new Date("2026-10-28T12:00:00Z");

describe("estadoDoFoco", () => {
  it("sem texto: sem foco (nulo, vazio e só espaços)", () => {
    expect(estadoDoFoco({ foco: null, focoOrigem: null, focoConfirmadoEm: null })).toEqual({ estado: "sem" });
    expect(estadoDoFoco({ foco: "", focoOrigem: null, focoConfirmadoEm: null })).toEqual({ estado: "sem" });
    expect(estadoDoFoco({ foco: "   ", focoOrigem: "escrito", focoConfirmadoEm: CONFIRMADO_EM })).toEqual({ estado: "sem" });
  });

  it("com texto e sem confirmação: sugerido", () => {
    expect(estadoDoFoco({ foco: "marketing com IA", focoOrigem: "sugerido", focoConfirmadoEm: null })).toEqual({ estado: "sugerido", texto: "marketing com IA" });
  });

  it("com texto e confirmação: confirmado, com a origem", () => {
    expect(estadoDoFoco({ foco: "marketing com IA", focoOrigem: "sugerido", focoConfirmadoEm: CONFIRMADO_EM })).toEqual({
      estado: "confirmado",
      texto: "marketing com IA",
      origem: "sugerido",
      confirmadoEm: CONFIRMADO_EM,
    });
  });
});

describe("focoConfirmado: o que o roteiro pode usar", () => {
  it("só o confirmado; a sugestão sem resposta nunca chega", () => {
    expect(focoConfirmado({ foco: "marketing com IA", focoOrigem: "sugerido", focoConfirmadoEm: null })).toBeNull();
    expect(focoConfirmado({ foco: "marketing com IA", focoOrigem: "escrito", focoConfirmadoEm: CONFIRMADO_EM })).toBe("marketing com IA");
  });

  it("conta antiga, sem as colunas: nada", () => {
    expect(focoConfirmado({})).toBeNull();
  });
});

describe("focoParaATela: só o que atravessa para o navegador", () => {
  it("o confirmado leva texto e origem, sem a data", () => {
    expect(focoParaATela({ foco: "x y z w v u t s", focoOrigem: "escrito", focoConfirmadoEm: CONFIRMADO_EM })).toEqual({ estado: "confirmado", texto: "x y z w v u t s", origem: "escrito" });
  });
});

describe("limparFoco", () => {
  it("junta os espaços, tira quebras de linha e os sinais de marcação", () => {
    expect(limparFoco("  marketing \n e   automação\t<b>com</b> IA  ")).toBe("marketing e automação b com /b IA");
  });

  it("troca o travessão por vírgula", () => {
    expect(limparFoco("marketing — para donos de empresa")).toBe("marketing, para donos de empresa");
  });
});

describe("problemasDaSugestao", () => {
  it("uma frase boa passa", () => {
    expect(problemasDaSugestao("marketing e automação com inteligência artificial, para donos de pequena empresa")).toEqual([]);
  });

  it("curta demais e comprida demais reprovam", () => {
    expect(problemasDaSugestao("IA")).toContain("curto demais");
    expect(problemasDaSugestao("a".repeat(TAMANHO_MAXIMO_DO_FOCO + 1))).toContain("comprido demais");
  });

  it("jargão do produto e jargão do motor reprovam", () => {
    expect(problemasDaSugestao("aumentar o engajamento de donos de empresa").some((m) => m.includes("engajamento"))).toBe(true);
    expect(problemasDaSugestao("o melhor nicho de donos de empresa").some((m) => m.includes("nicho"))).toBe(true);
  });
});
