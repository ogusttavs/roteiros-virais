/** A regra do "ramo com problema" no Início do admin (E46 PR 1). */
import { describe, expect, it } from "vitest";

import { horaNoBrasil, proxyParadoDasExecucoes, ramoComProblema, type LinhaDaMadrugada } from "./admin-inicio";

function linha(parcial: Partial<Omit<LinhaDaMadrugada, "comProblema">> = {}): Omit<LinhaDaMadrugada, "comProblema"> {
  return {
    nichoId: 1,
    nome: "Dentistas",
    busca: { novos: 10 },
    transcricao: { transcritos: 5 },
    analise: { analisados: 3 },
    temas: { quantos: 3, tentou: true, atrasado: false },
    ...parcial,
  };
}

describe("ramoComProblema", () => {
  it("tudo certo não é problema", () => {
    expect(ramoComProblema(linha())).toBe(false);
  });

  it("o estado das rotinas globais não marca ramo nenhum: só o que é do ramo conta", () => {
    expect(ramoComProblema(linha({ busca: { novos: 0 }, transcricao: { transcritos: 0 } }))).toBe(false);
  });

  it("sem tema só é problema depois da hora em que ele já devia existir", () => {
    expect(ramoComProblema(linha({ temas: { quantos: 0, tentou: false, atrasado: false } }))).toBe(false);
    expect(ramoComProblema(linha({ temas: { quantos: 0, tentou: false, atrasado: true } }))).toBe(true);
  });
});

describe("horaNoBrasil", () => {
  it("lê a hora do Brasil, não a do servidor", () => {
    expect(horaNoBrasil(new Date("2026-10-04T11:30:00Z"))).toBe(8);
    expect(horaNoBrasil(new Date("2026-10-04T02:59:00Z"))).toBe(23);
  });
});

/**
 * Hotfix do proxy (09/10/2026): o Inicio e o cartao da rotina "Transcrever" dizem "o proxy do YouTube esta sem trafego desde <dia>" enquanto a ultima noite que tentou baixar pelo
 * proxy tiver terminado parada por ele. As execucoes vem da mais nova para a mais velha.
 */
describe("proxyParadoDasExecucoes", () => {
  const dia = (d: number) => new Date(`2026-10-${String(d).padStart(2, "0")}T07:00:00Z`);
  const parada = (d: number, motivo: "proxy sem trafego" | "proxy fora do ar" = "proxy sem trafego", extra: Record<string, unknown> = {}) => ({
    iniciadoEm: dia(d),
    resumo: { youtubePausado: true, youtubePausadoMotivo: motivo, ...extra },
  });
  const boa = (d: number) => ({ iniciadoEm: dia(d), resumo: { youtubePausado: false, sucessos: { youtube: 3, tiktok: 0, instagram: 1 } } });
  const semProxy = (d: number) => ({ iniciadoEm: dia(d), resumo: { youtubePausado: false, sucessos: { youtube: 0, tiktok: 0, instagram: 2 } } });

  it("sem execucao nenhuma, ou com a ultima boa, o proxy nao esta parado", () => {
    expect(proxyParadoDasExecucoes([])).toBeNull();
    expect(proxyParadoDasExecucoes([boa(9), parada(8)])).toBeNull();
    expect(proxyParadoDasExecucoes([{ iniciadoEm: dia(9), resumo: null }])).toBeNull();
  });

  it("a ultima noite parada pelo proxy: o motivo dela, e desde o inicio da rodada quando o job nao anotou o instante", () => {
    expect(proxyParadoDasExecucoes([parada(9)])).toEqual({ motivo: "proxy sem trafego", desde: dia(9) });
  });

  it("noites seguidas paradas: desde a mais antiga delas, parando na ultima boa", () => {
    const resultado = proxyParadoDasExecucoes([parada(9), parada(8), parada(7), boa(6), parada(5)]);
    expect(resultado).toEqual({ motivo: "proxy sem trafego", desde: dia(7) });
  });

  it("o instante que o job anotou (proxyPausadoDesde) vale mais que o inicio da rodada", () => {
    const anotado = "2026-10-03T04:12:30.000Z";
    const resultado = proxyParadoDasExecucoes([parada(9), parada(8, "proxy sem trafego", { proxyPausadoDesde: anotado })]);
    expect(resultado?.desde).toEqual(new Date(anotado));
  });

  it("um instante anotado invalido cai no inicio da rodada, sem quebrar", () => {
    expect(proxyParadoDasExecucoes([parada(9, "proxy sem trafego", { proxyPausadoDesde: "nao e data" })])?.desde).toEqual(dia(9));
  });

  it("o motivo e o da noite mais nova: passou de sem trafego para fora do ar", () => {
    expect(proxyParadoDasExecucoes([parada(9, "proxy fora do ar"), parada(8, "proxy sem trafego")])).toEqual({ motivo: "proxy fora do ar", desde: dia(8) });
  });

  it("uma rodada que nao tentou nada pelo proxy (so Instagram, ou nada na fila) nao diz que ele voltou nem que parou: vale a anterior", () => {
    expect(proxyParadoDasExecucoes([semProxy(9), parada(8)])).toEqual({ motivo: "proxy sem trafego", desde: dia(8) });
    // ...e nao interrompe a contagem das noites paradas.
    expect(proxyParadoDasExecucoes([parada(9), semProxy(8), parada(7)])?.desde).toEqual(dia(7));
  });

  it("a rodada que baixou uma parte e depois o proxy acabou de novo conta como parada e encerra a contagem: o desde nao recua para noites em que ele ja tinha voltado", () => {
    const baixouAteAcabar = (d: number, extra: Record<string, unknown> = {}) => parada(d, "proxy sem trafego", { sucessos: { youtube: 20, tiktok: 0, instagram: 0 }, tentativas: { youtube: 21, tiktok: 0, instagram: 0 }, falhasPorProxy: 1, ...extra });
    const anotado = "2026-10-03T09:00:00.000Z";
    const resultado = proxyParadoDasExecucoes([parada(4), baixouAteAcabar(3, { proxyPausadoDesde: anotado }), parada(2), parada(1)]);
    expect(resultado).toEqual({ motivo: "proxy sem trafego", desde: new Date(anotado) });
  });

  it("a noite so de falhas por video (privado, robo) com o proxy respondendo diz que ele voltou, mesmo sem nenhum video lido", () => {
    const soFalhasDosVideos = { iniciadoEm: dia(9), resumo: { youtubePausado: false, sucessos: { youtube: 0, tiktok: 0, instagram: 0 }, tentativas: { youtube: 4, tiktok: 0, instagram: 0 }, falhasPorProxy: 0 } };
    expect(proxyParadoDasExecucoes([soFalhasDosVideos, parada(8)])).toBeNull();
  });

  it("a noite em que toda tentativa foi recusada pelo proxy nao prova que ele voltou (tentativas igual a falhasPorProxy)", () => {
    const recusadas = parada(9, "proxy fora do ar", { tentativas: { youtube: 3, tiktok: 0, instagram: 0 }, falhasPorProxy: 3 });
    expect(proxyParadoDasExecucoes([recusadas, parada(8, "proxy fora do ar")])).toEqual({ motivo: "proxy fora do ar", desde: dia(8) });
  });

  it("so o TikTok lido tambem prova que o proxy voltou (os dois passam por ele), e o Instagram nao", () => {
    const soTiktok = { iniciadoEm: dia(9), resumo: { sucessos: { youtube: 0, tiktok: 2, instagram: 0 } } };
    const soInstagram = { iniciadoEm: dia(9), resumo: { sucessos: { youtube: 0, tiktok: 0, instagram: 5 }, tentativas: { youtube: 0, tiktok: 0, instagram: 5 } } };
    expect(proxyParadoDasExecucoes([soTiktok, parada(8)])).toBeNull();
    expect(proxyParadoDasExecucoes([soInstagram, parada(8)])).toEqual({ motivo: "proxy sem trafego", desde: dia(8) });
  });

  it("o resumo malformado (sucessos que nao e objeto, numero em texto) nao quebra", () => {
    expect(proxyParadoDasExecucoes([{ iniciadoEm: dia(9), resumo: { sucessos: "nada", tentativas: 7, falhasPorProxy: "x" } }])).toBeNull();
    expect(proxyParadoDasExecucoes([{ iniciadoEm: dia(9), resumo: { youtubePausadoMotivo: "proxy recusou o acesso", sucessos: "nada" } }])).toEqual({ motivo: "proxy recusou o acesso", desde: dia(9) });
  });
  it("um motivo que o admin nao conhece nao acende o aviso", () => {
    expect(proxyParadoDasExecucoes([{ iniciadoEm: dia(9), resumo: { youtubePausadoMotivo: "outra coisa" } }])).toBeNull();
  });
});
