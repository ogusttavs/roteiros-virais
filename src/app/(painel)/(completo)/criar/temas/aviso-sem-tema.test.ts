import { describe, expect, it } from "vitest";

import { textosHoje } from "@/textos/hoje";

import { avisoSemTema } from "./aviso-sem-tema";

/** "2026-09-30T08:00:00Z" é 05:00 em America/Sao_Paulo (UTC-3, sem horário de verão desde 2019). */
const ANTES_DAS_0630 = new Date("2026-09-30T08:00:00Z");
/** "2026-09-30T09:29:00Z" é 06:29 em America/Sao_Paulo, um minuto antes do corte. */
const UM_MINUTO_ANTES = new Date("2026-09-30T09:29:00Z");
/** "2026-09-30T09:30:00Z" é 06:30 em America/Sao_Paulo, o corte exato. */
const NO_CORTE = new Date("2026-09-30T09:30:00Z");
/** "2026-09-30T12:00:00Z" é 09:00 em America/Sao_Paulo, bem depois do corte. */
const DEPOIS_DAS_0630 = new Date("2026-09-30T12:00:00Z");

describe("avisoSemTema (H3, item 1)", () => {
  it("com tema (status ok), nenhum aviso", () => {
    expect(
      avisoSemTema(
        {
          status: "ok",
          temas: [],
          dataUsada: "2026-09-30",
          avisoLinhaEditorial: null,
          objetivoRecomendado: null,
          constancia: { tipo: "primeiro_dia" },
        },
        DEPOIS_DAS_0630,
      ),
    ).toBeNull();
  });

  it("sem tema, antes das 6h30: pode ser só cedo demais", () => {
    const aviso = avisoSemTema({ status: "sem_tema", constancia: { tipo: "primeiro_dia" } }, ANTES_DAS_0630);
    expect(aviso).toEqual({ titulo: textosHoje.vazioTitulo, texto: textosHoje.vazio });
  });

  it("sem tema, um minuto antes do corte: ainda o aviso de cedo demais", () => {
    const aviso = avisoSemTema({ status: "sem_tema", constancia: { tipo: "primeiro_dia" } }, UM_MINUTO_ANTES);
    expect(aviso).toEqual({ titulo: textosHoje.vazioTitulo, texto: textosHoje.vazio });
  });

  it("sem tema, exatamente às 6h30: já é o aviso de depois (o corte é inclusivo)", () => {
    const aviso = avisoSemTema({ status: "sem_tema", constancia: { tipo: "primeiro_dia" } }, NO_CORTE);
    expect(aviso).toEqual({ titulo: textosHoje.semTemaDepoisTitulo, texto: textosHoje.semTemaDepois });
  });

  it("sem tema, depois das 6h30: o tema já devia ter saído e não saiu", () => {
    const aviso = avisoSemTema({ status: "sem_tema", constancia: { tipo: "primeiro_dia" } }, DEPOIS_DAS_0630);
    expect(aviso).toEqual({ titulo: textosHoje.semTemaDepoisTitulo, texto: textosHoje.semTemaDepois });
  });

  it("erro na busca, a qualquer hora: o aviso de erro, não o de sem tema", () => {
    expect(avisoSemTema({ status: "erro" }, ANTES_DAS_0630)).toEqual({
      titulo: textosHoje.erroTitulo,
      texto: textosHoje.erro,
    });
    expect(avisoSemTema({ status: "erro" }, DEPOIS_DAS_0630)).toEqual({
      titulo: textosHoje.erroTitulo,
      texto: textosHoje.erro,
    });
  });

  it("ainda lendo, antes das 6h30: o aviso de leitura vence o de cedo demais (M1, item 5)", () => {
    const aviso = avisoSemTema({ status: "sem_tema", constancia: { tipo: "primeiro_dia" } }, ANTES_DAS_0630, true);
    expect(aviso).toEqual({ titulo: textosHoje.aindaLendoTitulo, texto: textosHoje.aindaLendo });
  });

  it("ainda lendo, depois das 6h30: o aviso de leitura vence o de não saiu (M1, item 5)", () => {
    const aviso = avisoSemTema({ status: "sem_tema", constancia: { tipo: "primeiro_dia" } }, DEPOIS_DAS_0630, true);
    expect(aviso).toEqual({ titulo: textosHoje.aindaLendoTitulo, texto: textosHoje.aindaLendo });
  });

  it("ainda lendo, mas com erro na busca: o aviso de erro continua vencendo (M1, item 5)", () => {
    const aviso = avisoSemTema({ status: "erro" }, DEPOIS_DAS_0630, true);
    expect(aviso).toEqual({ titulo: textosHoje.erroTitulo, texto: textosHoje.erro });
  });

  it("sem o terceiro argumento, o comportamento de antes continua (padrão false)", () => {
    const aviso = avisoSemTema({ status: "sem_tema", constancia: { tipo: "primeiro_dia" } }, ANTES_DAS_0630);
    expect(aviso).toEqual({ titulo: textosHoje.vazioTitulo, texto: textosHoje.vazio });
  });
});

/** E45 PR 2 (decisão 35): o que se sabe do ramo vale mais que o horário, e o ramo sem base não parece uma falha. */
describe("avisoSemTema: o estado do ramo", () => {
  const SEM_TEMA = { status: "sem_tema" as const, constancia: { tipo: "primeiro_dia" as const } };

  it("ramo sem base (nenhum vídeo): 'o seu ramo ainda está sendo pesquisado', a qualquer hora, e nunca 'hoje não saiu tema'", () => {
    for (const quando of [ANTES_DAS_0630, DEPOIS_DAS_0630]) {
      expect(avisoSemTema(SEM_TEMA, quando, { semBase: true })).toEqual({ titulo: textosHoje.ramoNovoTitulo, texto: textosHoje.ramoNovo });
    }
    expect(textosHoje.ramoNovoTitulo).toBe("O seu ramo ainda está sendo pesquisado");
    expect(textosHoje.ramoNovo).toContain("a partir da próxima madrugada");
  });

  it("marca sem ramo e com pedido aberto: 'a gente está conferindo o seu ramo'", () => {
    expect(avisoSemTema(SEM_TEMA, DEPOIS_DAS_0630, { emConferencia: true })).toEqual({
      titulo: textosHoje.ramoEmConferenciaTitulo,
      texto: textosHoje.ramoEmConferencia,
    });
  });

  it("a ordem: em conferência vale mais que sem base, que vale mais que lendo, que vale mais que o horário", () => {
    expect(avisoSemTema(SEM_TEMA, DEPOIS_DAS_0630, { emConferencia: true, semBase: true, aindaLendo: true })?.titulo).toBe(textosHoje.ramoEmConferenciaTitulo);
    expect(avisoSemTema(SEM_TEMA, DEPOIS_DAS_0630, { semBase: true, aindaLendo: true })?.titulo).toBe(textosHoje.ramoNovoTitulo);
    expect(avisoSemTema(SEM_TEMA, DEPOIS_DAS_0630, { aindaLendo: true })?.titulo).toBe(textosHoje.aindaLendoTitulo);
    expect(avisoSemTema(SEM_TEMA, DEPOIS_DAS_0630, {})?.titulo).toBe(textosHoje.semTemaDepoisTitulo);
    expect(avisoSemTema(SEM_TEMA, ANTES_DAS_0630, {})?.titulo).toBe(textosHoje.vazioTitulo);
  });

  it("o boolean de antes ainda é o aindaLendo", () => {
    expect(avisoSemTema(SEM_TEMA, DEPOIS_DAS_0630, true)?.titulo).toBe(textosHoje.aindaLendoTitulo);
  });

  it("com tema ou com erro, o estado do ramo não muda nada", () => {
    expect(avisoSemTema({ status: "erro" }, DEPOIS_DAS_0630, { semBase: true })?.titulo).toBe(textosHoje.erroTitulo);
  });
});
