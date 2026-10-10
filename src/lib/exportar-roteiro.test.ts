import { afterEach, describe, expect, it, vi } from "vitest";

import { ErroDeAcao } from "@/lib/resultado-acao";

import { pedirImagensDoRoteiro, pedirPdfDoRoteiro } from "./exportar-roteiro";

afterEach(() => vi.unstubAllGlobals());

function resposta(corpo: unknown, status: number, tipo = "application/json") {
  return new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status, headers: { "content-type": tipo } });
}

describe("o pedido do PDF e da imagem com as marcas de fala", () => {
  it("leva ?marcas=1 só quando pedido", async () => {
    const fetchFalso = vi.fn().mockImplementation(async () => resposta("%PDF-1.4", 200, "application/pdf"));
    vi.stubGlobal("fetch", fetchFalso);
    await pedirPdfDoRoteiro(7);
    await pedirPdfDoRoteiro(7, { comMarcas: true });
    expect(fetchFalso.mock.calls.map((c) => c[0])).toEqual(["/api/roteiros/7/pdf", "/api/roteiros/7/pdf?marcas=1"]);
    const fetchDaImagem = vi.fn().mockResolvedValue(resposta({ nome: "roteiro-x", imagens: ["aGk="] }, 200));
    vi.stubGlobal("fetch", fetchDaImagem);
    await pedirImagensDoRoteiro(7, { comMarcas: true });
    expect(fetchDaImagem.mock.calls[0][0]).toBe("/api/roteiros/7/imagem?marcas=1");
  });

  it("a frase das marcas que não puderam ser escritas chega como erro da tela, com o caminho de baixar sem elas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => resposta({ erro: "marcas", mensagem: "Não consegui marcar a fala agora." }, 502)));
    await expect(pedirPdfDoRoteiro(7, { comMarcas: true })).rejects.toBeInstanceOf(ErroDeAcao);
    await expect(pedirPdfDoRoteiro(7, { comMarcas: true })).rejects.toThrow("Não consegui marcar a fala agora.");
    await expect(pedirImagensDoRoteiro(7, { comMarcas: true })).rejects.toThrow("Não consegui marcar a fala agora.");
  });

  it("outro erro do servidor continua o erro genérico de sempre", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta({ erro: "nao foi possivel gerar o pdf agora, tente de novo" }, 504)));
    const falha = await pedirPdfDoRoteiro(7).catch((e) => e);
    expect(falha).toBeInstanceOf(Error);
    expect(falha).not.toBeInstanceOf(ErroDeAcao);
  });
});
