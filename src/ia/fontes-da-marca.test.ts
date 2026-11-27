import { describe, expect, it } from "vitest";

import { montarFontesDaMarca } from "./fontes-da-marca";
import { montarFontesDosFatos } from "./prompts/roteiro";

const MOMENTO = { onde: "na recepção", oQueEstaAcontecendo: "chegou uma paciente com medo", oQueDaParaMostrar: "a sala" };

describe("montarFontesDaMarca", () => {
  it("deriva: cada parte aparece literalmente, na mesma ordem, em montarFontesDosFatos", () => {
    const casos = [
      { perfilCompilado: "Clínica X.", camadaExclusiva: "Só nós: aparelho invisível.", tema: "medo de anestesia", objetivoDoVideo: "mostrar o cuidado", observacao: "fale do preço" },
      { perfilCompilado: "Clínica X.", camadaExclusiva: "", momento: MOMENTO, tema: "ignorado" },
      { perfilCompilado: "Loja Y.", camadaExclusiva: "" },
    ];
    for (const dados of casos) {
      const marca = montarFontesDaMarca(dados);
      const completa = montarFontesDosFatos({
        ...dados,
        noticia: { titulo: "Notícia de terceiros", resumo: null, angulo: null },
        evidencias: [{ assunto: "a", gancho: "Minha paciente chegou chorando", estrutura: "b", fechamento: "", chamadaFinal: "" }],
      });
      for (const parte of marca.split("\n\n")) expect(completa).toContain(parte);
      expect(completa.startsWith(marca)).toBe(true);
    }
  });

  it("não traz a evidência, a notícia, a pesquisa, os comentários nem a marca citada, e traz o perfil", () => {
    const marca = montarFontesDaMarca({ perfilCompilado: "Perfil do dono.", camadaExclusiva: "", tema: "tema da pessoa" });
    expect(marca).toContain("Perfil do dono.");
    expect(marca).not.toMatch(/Evidência|Notícia|Dados da pesquisa|comentários|Marca citada/);
  });
});
