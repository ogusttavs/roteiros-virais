import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const gerarEstruturadoMock = vi.fn();
const registrarGeracaoMock = vi.fn().mockResolvedValue(1);

vi.mock("./cliente", () => ({
  gerarEstruturado: (...args: unknown[]) => gerarEstruturadoMock(...args),
}));
vi.mock("./registro", () => ({
  registrarGeracao: (...args: unknown[]) => registrarGeracaoMock(...args),
}));

import { ErroIA } from "./erro";
import { gerarComVerificacao, verificarLocalmente } from "./verificador";

const usoZero = { tokensEntrada: 0, tokensSaida: 0, tokensCacheLeitura: 0, tokensCacheEscrita: 0 };

describe("verificarLocalmente", () => {
  it("reprova travessao", () => {
    const r = verificarLocalmente({ corpo: "um texto \u2014 com travessao" });
    expect(r.aprovado).toBe(false);
  });

  it("reprova emoji", () => {
    const r = verificarLocalmente({ corpo: "seu roteiro esta pronto \u{1F389}" });
    expect(r.aprovado).toBe(false);
  });

  it("reprova jargao", () => {
    const r = verificarLocalmente({ corpo: "isso aumenta o engajamento" });
    expect(r.aprovado).toBe(false);
  });

  it("aceita gancho, que e permitido", () => {
    const r = verificarLocalmente({ corpo: "o gancho do video e forte" });
    expect(r.aprovado).toBe(true);
  });

  it("reprova quando exige evidencia e nao ha nenhuma", () => {
    const r = verificarLocalmente(
      { corpo: "texto limpo" },
      { exigeEvidencia: true, evidencias: [] },
    );
    expect(r.aprovado).toBe(false);
    expect(r.motivos.join(" ")).toContain("evidencia");
  });

  it("aprova com evidencia quando exigida", () => {
    const r = verificarLocalmente(
      { corpo: "texto limpo" },
      { exigeEvidencia: true, evidencias: [1, 2] },
    );
    expect(r.aprovado).toBe(true);
  });

  it("reprova quando fere uma proibicao do cliente", () => {
    const r = verificarLocalmente(
      { corpo: "aqui a gente da garantia total para todo mundo" },
      { proibicoes: ["garantia total"] },
    );
    expect(r.aprovado).toBe(false);
  });

  it("aprova texto limpo sem proibicao nem exigencia de evidencia", () => {
    const r = verificarLocalmente({ corpo: "um texto direto e calmo" });
    expect(r.aprovado).toBe(true);
    expect(r.motivos).toEqual([]);
  });
});

describe("gerarComVerificacao", () => {
  afterEach(() => {
    gerarEstruturadoMock.mockReset();
    registrarGeracaoMock.mockClear();
  });

  const parametrosBase = {
    tarefa: "roteiro" as const,
    nivel: "forte" as const,
    schema: z.object({ corpo: z.string() }),
    sistemaEstavel: "sistema estavel",
    versaoPrompt: "1.0.0",
    extrairCampos: (dados: { corpo: string }) => ({ corpo: dados.corpo }),
  };

  it("reprova a primeira tentativa, refaz com o motivo anexado, e devolve a segunda quando aprova", async () => {
    gerarEstruturadoMock
      .mockResolvedValueOnce({
        dados: { corpo: "texto ruim \u2014 com travessao" },
        modelo: "mock",
        ...usoZero,
      })
      .mockResolvedValueOnce({ dados: { corpo: "texto limpo" }, modelo: "mock", ...usoZero })
      .mockResolvedValueOnce({
        dados: { aprovado: true, motivo: null },
        modelo: "mock",
        ...usoZero,
      });

    const resultado = await gerarComVerificacao({ ...parametrosBase, entrada: "entrada original" });

    expect(resultado).toEqual({ corpo: "texto limpo" });
    expect(gerarEstruturadoMock).toHaveBeenCalledTimes(3);

    const segundaChamada = gerarEstruturadoMock.mock.calls[1][0] as { entrada: string };
    expect(segundaChamada.entrada).toContain("reprovada");
    expect(segundaChamada.entrada).toContain("travessao");

    // as duas tentativas da tarefa real ficam registradas, mais a chamada de verificarTexto
    expect(registrarGeracaoMock).toHaveBeenCalledTimes(3);
  });

  it("lanca ErroIA quando as duas tentativas reprovam na checagem local", async () => {
    gerarEstruturadoMock.mockResolvedValue({
      dados: { corpo: "sempre ruim \u2014 com travessao" },
      modelo: "mock",
      ...usoZero,
    });

    await expect(
      gerarComVerificacao({ ...parametrosBase, entrada: "entrada original" }),
    ).rejects.toThrow(ErroIA);

    // nunca chega a chamar a tarefa verificarTexto, pois reprova local nas duas vezes
    expect(gerarEstruturadoMock).toHaveBeenCalledTimes(2);
    expect(registrarGeracaoMock).toHaveBeenCalledTimes(2);
  });
});
