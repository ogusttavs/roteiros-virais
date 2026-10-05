import { describe, expect, it } from "vitest";

import {
  calcularEsperaMs,
  ErroMetaApi,
  erroMetaEhDaConta,
  erroMetaEhHashtagInexistente,
  erroMetaEhTokenOuLimite,
  JANELA_MS,
  lerUsoDaMeta,
  PausaDaMeta,
} from "./meta-api";

describe("erroMetaEhDaConta", () => {
  it("codigo 100 (conta pessoal ou de criador) e da conta", () => {
    expect(erroMetaEhDaConta(new ErroMetaApi("x", 100))).toBe(true);
  });

  /** Chamada real do Fable contra um handle inventado, revisao do PR #35: `{ code: 110, error_subcode: 2207013, message: "Invalid user id" }`. */
  it("codigo 110 (conta que nao existe) e da conta", () => {
    expect(erroMetaEhDaConta(new ErroMetaApi("Invalid user id", 110, 2207013))).toBe(true);
  });

  it.each([190, 4, 17, 32, 613, 1, undefined])("codigo %s nao e da conta", (codigo) => {
    expect(erroMetaEhDaConta(new ErroMetaApi("x", codigo))).toBe(false);
  });
});

describe("erroMetaEhTokenOuLimite", () => {
  it.each([190, 4, 17, 32, 613])("codigo %i (token vencido ou limite de taxa) e token ou limite", (codigo) => {
    expect(erroMetaEhTokenOuLimite(new ErroMetaApi("x", codigo))).toBe(true);
  });

  it.each([100, 110, 1, undefined])("codigo %s nao e token ou limite", (codigo) => {
    expect(erroMetaEhTokenOuLimite(new ErroMetaApi("x", codigo))).toBe(false);
  });
});

describe("erroMetaEhHashtagInexistente", () => {
  /** Corpo real da chamada de leitura direta contra "limpezadepaineldecarro", prova do PR #38, 10/09/2026. */
  it("code 24 com error_subcode 2207024 (o corpo real da prova) e hashtag inexistente", () => {
    expect(
      erroMetaEhHashtagInexistente(
        new ErroMetaApi("The requested resource does not exist", 24, 2207024),
      ),
    ).toBe(true);
  });

  it("code 24 sem o subcode 2207024 nao e hashtag inexistente (24 tambem e generico de outros recursos)", () => {
    expect(erroMetaEhHashtagInexistente(new ErroMetaApi("x", 24, 999))).toBe(false);
    expect(erroMetaEhHashtagInexistente(new ErroMetaApi("x", 24))).toBe(false);
  });

  it.each([100, 110, 190, 1, undefined])("codigo %s nao e hashtag inexistente", (codigo) => {
    expect(erroMetaEhHashtagInexistente(new ErroMetaApi("x", codigo, 2207024))).toBe(false);
  });
});

function cab(valores: Record<string, string>) {
  return { get: (nome: string) => valores[nome.toLowerCase()] ?? null };
}

describe("lerUsoDaMeta (o limite do aplicativo: os cabeçalhos x-app-usage e x-business-use-case-usage)", () => {
  it("x-app-usage: a maior das três medidas", () => {
    expect(lerUsoDaMeta(cab({ "x-app-usage": '{"call_count":12,"total_time":83,"total_cputime":5}' }))).toEqual({ percentual: 83, medida: "total_time", esperaMin: null });
  });

  it("x-business-use-case-usage: a maior medida entre todas as contas e usos, e quando o acesso volta", () => {
    const corpo = JSON.stringify({ "1784": [{ type: "instagram", call_count: 40, total_time: 2, total_cputime: 1, estimated_time_to_regain_access: 0 }], "1785": [{ type: "instagram", call_count: 91, total_time: 5, total_cputime: 5, estimated_time_to_regain_access: 17 }] });
    expect(lerUsoDaMeta(cab({ "x-business-use-case-usage": corpo }))).toEqual({ percentual: 91, medida: "call_count", esperaMin: 17 });
  });

  it("os dois cabeçalhos juntos: vale o maior", () => {
    const leitura = lerUsoDaMeta(cab({ "x-app-usage": '{"call_count":30}', "x-business-use-case-usage": '{"1":[{"call_count":55}]}' }));
    expect(leitura?.percentual).toBe(55);
  });

  it("sem cabeçalho, ou com um que não é JSON, ou sem número: nenhuma leitura, e nada quebra", () => {
    expect(lerUsoDaMeta(cab({}))).toBeNull();
    expect(lerUsoDaMeta(cab({ "x-app-usage": "isso nao e json" }))).toBeNull();
    expect(lerUsoDaMeta(cab({ "x-app-usage": '{"call_count":"muito"}' }))).toBeNull();
    expect(lerUsoDaMeta(cab({ "x-business-use-case-usage": "[1,2]" }))).toBeNull();
  });
});

describe("PausaDaMeta", () => {
  it("é um ErroMetaApi de limite (código 4): quem trata limite continua tratando a pausa", () => {
    const pausa = new PausaDaMeta(new Date("2026-10-05T12:00:00Z"));
    expect(pausa).toBeInstanceOf(ErroMetaApi);
    expect(erroMetaEhTokenOuLimite(pausa)).toBe(true);
    expect(pausa.message).toContain("limite da Meta, continua na próxima hora");
  });
});

describe("calcularEsperaMs", () => {
  it("meia janela ja passada, falta a outra metade", () => {
    const maisAntiga = new Date("2026-09-09T10:00:00Z");
    const agora = new Date("2026-09-09T10:30:00Z");
    expect(calcularEsperaMs(maisAntiga, agora)).toBe(JANELA_MS / 2);
  });

  it("janela inteira ja passada, nada a esperar (nunca negativo)", () => {
    const maisAntiga = new Date("2026-09-09T10:00:00Z");
    const agora = new Date("2026-09-09T12:00:00Z");
    expect(calcularEsperaMs(maisAntiga, agora)).toBe(0);
  });

  it("agora igual a mais antiga, falta a janela inteira", () => {
    const instante = new Date("2026-09-09T10:00:00Z");
    expect(calcularEsperaMs(instante, instante)).toBe(JANELA_MS);
  });

  it("respeita uma janela customizada", () => {
    const maisAntiga = new Date("2026-09-09T10:00:00Z");
    const agora = new Date("2026-09-09T10:00:05Z");
    expect(calcularEsperaMs(maisAntiga, agora, 10_000)).toBe(5_000);
  });
});
