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

  it("um motivo que o admin nao conhece nao acende o aviso", () => {
    expect(proxyParadoDasExecucoes([{ iniciadoEm: dia(9), resumo: { youtubePausadoMotivo: "outra coisa" } }])).toBeNull();
  });
});
