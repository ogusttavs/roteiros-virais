import { describe, expect, it } from "vitest";

import { fichaInicialDaFolha } from "./ficha-inicial";

describe("fichaInicialDaFolha", () => {
  it("sem valores, a recomendada pelo tema (ou nenhuma, sem recomendação)", () => {
    expect(fichaInicialDaFolha(undefined, "conversao")).toBe("me_chamem");
    expect(fichaInicialDaFolha(undefined, "engajamento")).toBe("guardem");
    expect(fichaInicialDaFolha(undefined, null)).toBeNull();
  });

  it("vindo de um momento ou de um item do plano com ficha, vale a que veio", () => {
    expect(fichaInicialDaFolha({ ficha: "comentem", objetivo: "engajamento" }, "alcance")).toBe("comentem");
  });

  it("vindo sem a ficha dita (item do plano), cai no padrão do objetivo que veio, e não no recomendado do tema", () => {
    expect(fichaInicialDaFolha({ objetivo: "conversao" }, "alcance")).toBe("me_chamem");
  });

  it("a ficha nula de um Story ou de um vídeo sem fala continua nula (a pessoa escolhe se trocar para vídeo falado)", () => {
    expect(fichaInicialDaFolha({ ficha: null, objetivo: "engajamento", duracao: "curto" }, "alcance")).toBeNull();
    expect(fichaInicialDaFolha({ ficha: null, objetivo: "engajamento" }, "alcance")).toBeNull();
  });

  it("o vídeo longo não guarda a ficha: ao reabrir, a folha usa a padrão do objetivo guardado, nunca abre sem nenhuma marcada (achado da revisão do PR 4a)", () => {
    expect(fichaInicialDaFolha({ ficha: null, objetivo: "engajamento", duracao: "longo" }, null)).toBe("guardem");
    expect(fichaInicialDaFolha({ ficha: null, objetivo: "alcance", duracao: "longo" }, "conversao")).toBe("veja");
  });
});
