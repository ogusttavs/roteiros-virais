/** A leitura da resposta da busca na web (E54): pura, contra uma resposta no formato da ferramenta, e o simulador do `AI_PROVIDER=mock`. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buscarNaWeb, lerBlocosDaBusca, type BlocoDeResposta } from "./busca-na-web";
import { ErroIA } from "./erro";
import { buscaSimulada } from "./mock-busca";

const RESPOSTA = JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", "pesquisa", "resposta-da-busca.json"), "utf8")) as { content: BlocoDeResposta[] };

describe("lerBlocosDaBusca", () => {
  const lido = lerBlocosDaBusca(RESPOSTA.content);

  it("junta os blocos partidos no meio da frase na linha deles, com as citações da linha", () => {
    const textos = lido.linhas.map((l) => l.texto.trim());
    expect(textos).toContain("- A inflação oficial acumulou 4,5% em 12 meses, segundo o IBGE.");
    expect(textos).toContain("- Para o G1, a alta dos alimentos foi de 5,1% no período.");
    const linhaIbge = lido.linhas.find((l) => l.texto.includes("inflação oficial"))!;
    expect(linhaIbge.citacoes).toEqual([
      { url: "https://www.ibge.gov.br/explica/inflacao.php", titulo: "IPCA: o que é e como é medido | IBGE", trecho: "O IPCA acumulado nos últimos 12 meses ficou em 4,5%, informou o IBGE." },
    ]);
  });

  it("a mesma citação repetida na linha vale uma vez só", () => {
    const linhaG1 = lido.linhas.find((l) => l.texto.includes("alimentos"))!;
    expect(linhaG1.citacoes).toHaveLength(1);
  });

  it("o texto sem citação continua sendo linha (o código decide o que fazer com ela), e a linha vazia some", () => {
    const sem = lido.linhas.find((l) => l.texto.startsWith("Vou buscar"));
    expect(sem?.citacoes).toEqual([]);
    expect(lido.linhas.every((l) => l.texto.trim() !== "")).toBe(true);
  });

  it("guarda as páginas que a busca devolveu, com a idade como veio (inclusive a nula)", () => {
    expect(lido.paginas).toEqual([
      { url: "https://www.ibge.gov.br/explica/inflacao.php", titulo: "IPCA: o que é e como é medido | IBGE", idade: "April 30, 2026" },
      { url: "https://g1.globo.com/economia/noticia/2026/05/inflacao-acumulada.ghtml", titulo: "Inflação em 12 meses fica em 4,5% | G1", idade: null },
    ]);
  });

  it("a busca que deu erro não conta (a Anthropic não a cobra) e o código do erro fica", () => {
    expect(lido.buscas).toBe(1);
    expect(lido.errosDaFerramenta).toEqual(["unavailable"]);
  });

  it("uma resposta que não é a esperada não derruba a leitura", () => {
    const estranho = lerBlocosDaBusca([
      { type: "web_search_tool_result", content: "texto solto" },
      { type: "web_search_tool_result", content: [{ type: "web_search_result" }, null] } as BlocoDeResposta,
      { type: "text", citations: [{ type: "char_location" }] } as BlocoDeResposta,
      { type: "tipo_novo" },
    ]);
    expect(estranho).toMatchObject({ linhas: [], paginas: [], buscas: 0, errosDaFerramenta: [] });
  });
});

describe("buscarNaWeb com o simulador", () => {
  const params = { sistemaEstavel: "s", entrada: "<pedido>preço de produtos de limpeza</pedido>", maxBuscas: 5, dominios: ["ibge.gov.br"] };

  it("devolve seis dados com citação, páginas e as buscas contadas, sem custo de token", async () => {
    const resposta = await buscarNaWeb(params);
    expect(resposta.modelo).toBe("mock");
    expect(resposta.linhas).toHaveLength(6);
    expect(resposta.linhas.every((l) => l.citacoes.length === 1)).toBe(true);
    expect(resposta.paginas).toHaveLength(6);
    expect(resposta.buscas).toBe(3);
    // o simulador conta as buscas, mas não cobra: em mock tudo custa zero
    expect(resposta.uso).toMatchObject({ tokensEntrada: 0, tokensSaida: 0, buscasNaWeb: 0 });
  });

  it("o teto de buscas manda: nunca mais do que `maxBuscas`", async () => {
    const resposta = await buscarNaWeb({ ...params, maxBuscas: 1 });
    expect(resposta.buscas).toBe(1);
  });

  it("os marcadores montam os casos de falha do contrato", async () => {
    expect((await buscarNaWeb({ ...params, entrada: "[mock:sem-achado]" })).linhas).toEqual([]);
    await expect(buscarNaWeb({ ...params, entrada: "[mock:erro-pesquisa]" })).rejects.toBeInstanceOf(ErroIA);
    const inventado = await buscarNaWeb({ ...params, entrada: "[mock:numero-inventado]" });
    expect(inventado.linhas.some((l) => l.texto.includes("99%"))).toBe(true);
  });

  it("as datas das páginas são relativas a hoje, no formato em inglês da ferramenta", () => {
    const resposta = buscaSimulada(params, new Date("2026-10-10T12:00:00Z"));
    expect(resposta.paginas[0].idade).toBe("August 31, 2026");
  });
});
