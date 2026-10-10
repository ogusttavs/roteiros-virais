import { describe, expect, it } from "vitest";

import type { TemaDoDia, TendenciaBrasil } from "@/db/schema";

import { assuntoSegueEmAlta, chaveDoAssunto, ehSensivel, temaDoMomentoAindaVale, temasQueAindaValem, tendenciasQueTocamOTema, type ListaDeAgora } from "./tendencias";

function assunto(texto: string, termos: string[] = [], sensivel = false): TendenciaBrasil {
  return { id: 1, coletadaEm: new Date("2026-10-06T08:50:00Z"), assunto: texto, chave: chaveDoAssunto(texto), termos, fontes: [{ fonte: "google", titulo: texto, url: null, trafego: "2000+", posicao: 1 }], posicao: 1, sensivel, criadoEm: new Date() };
}

const lista = (...assuntos: TendenciaBrasil[]): ListaDeAgora => ({ coletadaEm: new Date("2026-10-06T08:50:00Z"), assuntos });

function tema(titulo: string, doMomento?: { chave: string; termos: string[] }): TemaDoDia {
  return {
    titulo,
    descricao: "d",
    porQue: "p",
    evidencias: [],
    puxaPara: "alcance",
    ...(doMomento ? { doMomento: { ...doMomento, assunto: doMomento.chave, fonte: "Em alta no Google no Brasil", url: null, coletadaEm: "2026-10-06T08:50:00.000Z", encaixe: 8 } } : {}),
  };
}

describe("o que é sensível nunca vira tema sozinho", () => {
  it("tragédia, morte, crime e política partidária são sensíveis, sem acento nem maiúscula; o resto não é", () => {
    for (const texto of ["Morte de cantor aos 40 anos", "Acidente de ônibus deixa feridos", "Eleições 2026: debate", "Candidato lidera pesquisa", "Bolsonaro e Lula", "tragédia em Minas", "assassinato em SP"]) {
      expect(ehSensivel(texto), texto).toBe(true);
    }
    for (const texto of ["Fim da escala 6x1", "Jogo do Flamengo", "Preço do café sobe", "Black Friday antecipada", "Lançamento do iPhone", "Inauguração de loja no Brás"]) {
      expect(ehSensivel(texto), texto).toBe(false);
    }
  });
});

describe("o assunto do tema do momento segue em alta", () => {
  it("segue quando a lista de agora tem o mesmo assunto, ou um que divide um termo; sai quando nenhum divide", () => {
    const momento = { chave: chaveDoAssunto("Fim da escala 6x1"), termos: ["escala 6x1", "PEC"] };
    expect(assuntoSegueEmAlta(momento, lista(assunto("Fim da escala 6x1")).assuntos)).toBe(true);
    expect(assuntoSegueEmAlta(momento, lista(assunto("Senado debate a PEC", ["pec", "escala"])).assuntos)).toBe(true);
    expect(assuntoSegueEmAlta(momento, lista(assunto("Jogo do Flamengo", ["flamengo"])).assuntos)).toBe(false);
    expect(assuntoSegueEmAlta(momento, [])).toBe(false);
  });

  it("o tema comum sempre vale; o do momento só com a lista de agora e o assunto nela, e some quando o assunto sai", () => {
    const comum = tema("tema comum");
    const doMomento = tema("do momento", { chave: "fim da escala 6x1", termos: ["escala 6x1"] });
    const agora = lista(assunto("Fim da escala 6x1"));
    const semAssunto = lista(assunto("Jogo do Flamengo"));
    expect(temaDoMomentoAindaVale(comum, null)).toBe(true);
    expect(temaDoMomentoAindaVale(doMomento, agora)).toBe(true);
    expect(temaDoMomentoAindaVale(doMomento, semAssunto)).toBe(false);
    expect(temaDoMomentoAindaVale(doMomento, null)).toBe(false);
    expect(temasQueAindaValem([comum, doMomento], agora).map((t) => t.titulo)).toEqual(["tema comum", "do momento"]);
    expect(temasQueAindaValem([comum, doMomento], semAssunto).map((t) => t.titulo)).toEqual(["tema comum"]);
  });
});

describe("os assuntos em alta que tocam o tema da nota", () => {
  it("casa pela raiz da palavra, inclusive os sensíveis (aqui é só sinal), até 5; sem lista ou sem palavra, vazio", () => {
    const l = lista(assunto("Eleições 2026", ["eleição"], true), assunto("Jogo do Flamengo"), assunto("Fim da escala 6x1", ["jornada de trabalho"]));
    expect(tendenciasQueTocamOTema("o que a eleição muda para o meu negócio", l)).toEqual([{ assunto: "Eleições 2026", fonte: "google", sensivel: true }]);
    expect(tendenciasQueTocamOTema("como a jornada de trabalho muda a minha equipe", l).map((t) => t.assunto)).toEqual(["Fim da escala 6x1"]);
    expect(tendenciasQueTocamOTema("como limpar sofá", l)).toEqual([]);
    expect(tendenciasQueTocamOTema("a eleição", null)).toEqual([]);
    expect(tendenciasQueTocamOTema("de um", l)).toEqual([]);
  });

  it("o assunto trazido preso ao Tema livre entra sempre e na frente, mesmo sem palavra em comum; o delicado e o que saiu da lista não entram (E55 PR 2b)", () => {
    const l = lista(assunto("Eleições 2026", ["eleição"], true), assunto("Jogo do Flamengo"), assunto("Fim da escala 6x1", ["jornada de trabalho"]));
    // O texto da pessoa não repete nenhuma palavra do assunto preso: ele entra do mesmo jeito, na frente do que casa.
    expect(tendenciasQueTocamOTema("como a jornada de trabalho muda a minha equipe", l, "jogo do flamengo").map((t) => t.assunto)).toEqual(["Jogo do Flamengo", "Fim da escala 6x1"]);
    // Já casando pelo texto, não duplica.
    expect(tendenciasQueTocamOTema("como a jornada de trabalho muda a minha equipe", l, "fim da escala 6x1").map((t) => t.assunto)).toEqual(["Fim da escala 6x1"]);
    // O delicado nunca é aceito como assunto preso, e a chave de um assunto que já saiu da lista é ignorada.
    expect(tendenciasQueTocamOTema("como limpar sofá", l, "eleicoes 2026")).toEqual([]);
    expect(tendenciasQueTocamOTema("como limpar sofá", l, "assunto que saiu")).toEqual([]);
  });
});
