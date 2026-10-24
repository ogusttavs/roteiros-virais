import { describe, expect, it } from "vitest";

import {
  calcularEsperaMs,
  ErroMetaApi,
  erroMetaEhDaConta,
  erroMetaEhHashtagInexistente,
  erroMetaEhTokenOuLimite,
  descreverCausaDaPausa,
  JANELA_MS,
  LIMITE_DE_USO_DAS_CONTAS_PERCENTUAL,
  LIMITE_DE_USO_PERCENTUAL,
  lerCabecalhosDeUso,
  lerUsoDaMeta,
  maiorUsoDaLeitura,
  MedidorDeUsoDaMeta,
  MIDIAS_POR_CONTA,
  PausaDaMeta,
  RESERVA_DAS_HASHTAGS_PERCENTUAL,
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

describe("lerCabecalhosDeUso (os três cabeçalhos de uso, `limites-graph-rate-limiting.md`)", () => {
  it("x-app-usage: as medidas que vieram, sem inventar as que faltam", () => {
    const leitura = lerCabecalhosDeUso(cab({ "x-app-usage": '{"call_count":28,"total_time":25}' }));
    expect(leitura.app).toEqual({ call_count: 28, total_time: 25 });
    expect(leitura.buc).toBeNull();
    expect(leitura.adAccount).toBeNull();
  });

  it("x-business-use-case-usage: o maior de cada medida entre todos os objetos, os tipos e a maior espera", () => {
    const corpo = JSON.stringify({
      "1": [{ type: "instagram", call_count: 40, total_time: 70, total_cputime: 1, estimated_time_to_regain_access: 0 }],
      "2": [{ type: "pages", call_count: 91, total_time: 5, total_cputime: 33, estimated_time_to_regain_access: 17 }],
      "3": [{ type: "instagram", call_count: 10, total_time: 6, total_cputime: 2, estimated_time_to_regain_access: 4 }],
    });
    const leitura = lerCabecalhosDeUso(cab({ "x-business-use-case-usage": corpo }));
    expect(leitura.buc).toEqual({ call_count: 91, total_time: 70, total_cputime: 33, estimated_time_to_regain_access: 17 });
    expect(leitura.tiposBuc).toEqual(["instagram", "pages"]);
    expect(leitura.esperaMin).toBe(17);
  });

  it("x-ad-account-usage: só acc_id_util_pct, guardado e nunca usado para pausar", () => {
    const leitura = lerCabecalhosDeUso(cab({ "x-ad-account-usage": '{"acc_id_util_pct":9.67,"reset_time_duration":100,"ads_api_access_tier":"standard_access"}' }));
    expect(leitura.adAccount).toEqual({ acc_id_util_pct: 9.67 });
    expect(maiorUsoDaLeitura(leitura)).toBeNull();
  });

  it("maiorUsoDaLeitura diz de qual cabeçalho veio a maior medida; empate fica com o primeiro lido (app)", () => {
    const so = maiorUsoDaLeitura(lerCabecalhosDeUso(cab({ "x-app-usage": '{"call_count":10,"total_time":83,"total_cputime":5}' })));
    expect(so).toEqual({ fonte: "x-app-usage", medida: "total_time", percentual: 83 });
    const dois = maiorUsoDaLeitura(lerCabecalhosDeUso(cab({ "x-app-usage": '{"call_count":30}', "x-business-use-case-usage": '{"1":[{"total_cputime":55}]}' })));
    expect(dois).toEqual({ fonte: "x-business-use-case-usage", medida: "total_cputime", percentual: 55 });
    const empate = maiorUsoDaLeitura(lerCabecalhosDeUso(cab({ "x-app-usage": '{"call_count":50}', "x-business-use-case-usage": '{"1":[{"total_time":50}]}' })));
    expect(empate?.fonte).toBe("x-app-usage");
  });

  it("cabeçalho que não é JSON, vazio ou com tipo errado não derruba nada", () => {
    const leitura = lerCabecalhosDeUso(cab({ "x-app-usage": "isso nao e json", "x-business-use-case-usage": "[1,2]", "x-ad-account-usage": '{"acc_id_util_pct":"alto"}' }));
    expect(leitura).toEqual({ app: null, buc: null, tiposBuc: [], adAccount: null, esperaMin: null });
  });
});

describe("MedidorDeUsoDaMeta (o maior valor visto de cada medida durante a rotina)", () => {
  it("guarda o maior de cada medida, por cabeçalho, e conta as respostas com e sem cabeçalho", () => {
    const medidor = new MedidorDeUsoDaMeta();
    medidor.registrar(lerCabecalhosDeUso(cab({ "x-app-usage": '{"call_count":10,"total_time":30,"total_cputime":12}' })));
    medidor.registrar(lerCabecalhosDeUso(cab({})));
    medidor.registrar(
      lerCabecalhosDeUso(
        cab({
          "x-app-usage": '{"call_count":8,"total_time":35,"total_cputime":9}',
          "x-business-use-case-usage": '{"1":[{"type":"instagram","call_count":20,"estimated_time_to_regain_access":3}]}',
        }),
      ),
    );
    medidor.registrar(lerCabecalhosDeUso(cab({ "x-business-use-case-usage": '{"1":[{"type":"instagram","call_count":15,"total_time":41,"estimated_time_to_regain_access":0}]}' })));
    expect(medidor.resumo()).toEqual({
      respostas: 4,
      respostasComCabecalhoDeUso: 3,
      xAppUsage: { call_count: 10, total_time: 35, total_cputime: 12 },
      xBusinessUseCaseUsage: { call_count: 20, total_time: 41, estimated_time_to_regain_access: 3, tipos: ["instagram"] },
      maior: { fonte: "x-business-use-case-usage", medida: "total_time", percentual: 41 },
    });
  });

  it("a primeira pausa vista é a que fica; a mesma pausa vista de novo não a troca", () => {
    const medidor = new MedidorDeUsoDaMeta();
    medidor.notarPausa({ origem: "uso", classe: "contas", fonte: "x-app-usage", medida: "call_count", percentual: 62, limite: 60 }, false);
    medidor.notarPausa({ origem: "erro", classe: "geral", codigoDeErro: 4 }, true);
    expect(medidor.resumo().pausa).toMatchObject({ medida: "call_count", percentual: 62, herdada: false });
  });

  it("o resumo é uma cópia: mexer nele não muda o medidor", () => {
    const medidor = new MedidorDeUsoDaMeta();
    medidor.registrar(lerCabecalhosDeUso(cab({ "x-app-usage": '{"call_count":1}' })));
    const copia = medidor.resumo();
    copia.respostas = 99;
    expect(medidor.resumo().respostas).toBe(1);
  });
});

describe("descreverCausaDaPausa e as constantes da fatia", () => {
  it("diz a medida, o percentual, o cabeçalho e o limite; ou o código de erro", () => {
    expect(descreverCausaDaPausa({ origem: "uso", classe: "geral", fonte: "x-app-usage", medida: "total_time", percentual: 83, limite: 80 })).toBe("total_time em 83% (x-app-usage), limite de 80%");
    expect(descreverCausaDaPausa({ origem: "erro", classe: "geral", codigoDeErro: 4 })).toBe("a Meta devolveu o código 4");
  });

  it("a Business Discovery pede 25 mídias e a leitura de contas para 20 pontos antes do limite geral", () => {
    expect(MIDIAS_POR_CONTA).toBe(25);
    expect(RESERVA_DAS_HASHTAGS_PERCENTUAL).toBe(20);
    expect(LIMITE_DE_USO_DAS_CONTAS_PERCENTUAL).toBe(LIMITE_DE_USO_PERCENTUAL - RESERVA_DAS_HASHTAGS_PERCENTUAL);
    expect(LIMITE_DE_USO_DAS_CONTAS_PERCENTUAL).toBeLessThan(LIMITE_DE_USO_PERCENTUAL);
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
