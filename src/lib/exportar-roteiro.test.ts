import { afterEach, describe, expect, it, vi } from "vitest";

import { pedirImagensDoRoteiro, pedirPdfDoRoteiro } from "./exportar-roteiro";

afterEach(() => vi.unstubAllGlobals());

function resposta(corpo: unknown, status: number, tipo = "application/json", cabecalhos: Record<string, string> = {}) {
  return new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status, headers: { "content-type": tipo, ...cabecalhos } });
}

describe("o pedido do PDF e da imagem com as marcas de fala", () => {
  it("leva ?marcas=1 só quando pedido", async () => {
    const fetchFalso = vi.fn().mockImplementation(async () => resposta("%PDF-1.4", 200, "application/pdf"));
    vi.stubGlobal("fetch", fetchFalso);
    await pedirPdfDoRoteiro(7);
    await pedirPdfDoRoteiro(7, { comMarcas: true });
    expect(fetchFalso.mock.calls.map((c) => c[0])).toEqual(["/api/roteiros/7/pdf", "/api/roteiros/7/pdf?marcas=1"]);
    const fetchDaImagem = vi.fn().mockImplementation(async () => resposta({ nome: "roteiro-x", imagens: ["aGk="] }, 200));
    vi.stubGlobal("fetch", fetchDaImagem);
    await pedirImagensDoRoteiro(7, { comMarcas: true });
    expect(fetchDaImagem.mock.calls[0][0]).toBe("/api/roteiros/7/imagem?marcas=1");
  });

  it("o arquivo sempre vem; o cabeçalho X-Marcas: nao-deu avisa que saiu sem as marcas pedidas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => resposta("%PDF-1.4", 200, "application/pdf", { "x-marcas": "nao-deu" })));
    const aviso = vi.fn();
    const pdf = await pedirPdfDoRoteiro(7, { comMarcas: true, aoNaoDarParaMarcar: aviso });
    expect(pdf.size).toBeGreaterThan(0);
    expect(aviso).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => resposta({ nome: "roteiro-x", imagens: ["aGk="] }, 200, "application/json", { "x-marcas": "nao-deu" })));
    const avisoDaImagem = vi.fn();
    const arquivos = await pedirImagensDoRoteiro(7, { comMarcas: true, aoNaoDarParaMarcar: avisoDaImagem });
    expect(arquivos).toHaveLength(1);
    expect(avisoDaImagem).toHaveBeenCalledTimes(1);
  });

  it("sem o cabeçalho, nenhum aviso", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => resposta("%PDF-1.4", 200, "application/pdf")));
    const aviso = vi.fn();
    await pedirPdfDoRoteiro(7, { comMarcas: true, aoNaoDarParaMarcar: aviso });
    expect(aviso).not.toHaveBeenCalled();
  });

  it("o erro do servidor continua o erro de sempre", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => resposta({ erro: "nao foi possivel gerar o pdf agora, tente de novo" }, 504)));
    await expect(pedirPdfDoRoteiro(7)).rejects.toThrow("o pdf nao veio");
  });
});
