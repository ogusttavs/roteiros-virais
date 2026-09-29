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
});
