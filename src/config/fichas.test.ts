/** As cinco fichas (E49 PR 1): o mapa ficha para objetivo, a ficha padrão de quem só tem o objetivo, e o rótulo que a tela mostra. */
import { describe, expect, it } from "vitest";

import { ehFicha, estruturaDaFicha, FICHAS_EM_ORDEM, fichaRecomendadaParaTema, fichaPadraoDoObjetivo, objetivoDaFicha, ROTULO_PARA_QUE, rotuloParaQue, ROTULO_STORY_PARA_QUEM } from "./fichas";

describe("fichas", () => {
  it("são cinco, e cada uma conta em um dos três objetivos (dúvida 2 do passo 18)", () => {
    expect(FICHAS_EM_ORDEM).toHaveLength(5);
    expect(FICHAS_EM_ORDEM.map(objetivoDaFicha)).toEqual(["alcance", "engajamento", "alcance", "engajamento", "conversao"]);
  });

  it("a ficha padrão de cada objetivo volta ao mesmo objetivo", () => {
    for (const o of ["alcance", "engajamento", "conversao"] as const) expect(objetivoDaFicha(fichaPadraoDoObjetivo(o))).toBe(o);
  });

  it("ehFicha só aceita as cinco", () => {
    expect(ehFicha("guardem")).toBe(true);
    expect(ehFicha("salvamento")).toBe(false);
    expect(ehFicha(undefined)).toBe(false);
  });

  it("o rótulo é o da ficha; sem ficha cai na padrão do objetivo; o Story mostra com quem já segue", () => {
    expect(rotuloParaQue({ ficha: "me_chamem", objetivo: "conversao" })).toBe("Para que te chamem");
    expect(rotuloParaQue({ ficha: null, objetivo: "engajamento" })).toBe(ROTULO_PARA_QUE.guardem);
    expect(rotuloParaQue({ ficha: null, objetivo: "alcance", formato: "story" })).toBe(ROTULO_STORY_PARA_QUEM);
  });
});

describe("fichaRecomendadaParaTema", () => {
  it("o objetivo que o tema puxa dá o lado; o texto do tema escolhe entre as duas fichas de cada objetivo", () => {
    expect(fichaRecomendadaParaTema({ titulo: "como fechar mais clientes", puxaPara: "conversao" })).toBe("me_chamem");
    expect(fichaRecomendadaParaTema({ titulo: "o jeito certo de lavar", puxaPara: "engajamento" })).toBe("guardem");
    expect(fichaRecomendadaParaTema({ titulo: "o erro que quase todo cliente comete", puxaPara: "engajamento" })).toBe("comentem");
    expect(fichaRecomendadaParaTema({ titulo: "vinagre limpa ou estraga?", puxaPara: "engajamento" })).toBe("comentem");
    expect(fichaRecomendadaParaTema({ titulo: "a mancha que todo mundo tem", puxaPara: "alcance" })).toBe("mandem");
    expect(fichaRecomendadaParaTema({ titulo: "um assunto novo do seu ramo", puxaPara: "alcance" })).toBe("veja");
  });

  it("as cinco fichas podem ser recomendadas", () => {
    const recomendadas = new Set([
      fichaRecomendadaParaTema({ titulo: "x", puxaPara: "alcance" }),
      fichaRecomendadaParaTema({ titulo: "todo mundo faz", puxaPara: "alcance" }),
      fichaRecomendadaParaTema({ titulo: "x", puxaPara: "engajamento" }),
      fichaRecomendadaParaTema({ titulo: "um erro comum", puxaPara: "engajamento" }),
      fichaRecomendadaParaTema({ titulo: "x", puxaPara: "conversao" }),
    ]);
    expect(recomendadas.size).toBe(5);
  });
});

describe("estruturaDaFicha", () => {
  it("'veja' sem evidência não afirma tendência; com evidência fala do assunto em alta", () => {
    expect(estruturaDaFicha("veja", false)).not.toContain("em alta agora");
    expect(estruturaDaFicha("veja", false)).toContain("não traz prova de tendência");
    expect(estruturaDaFicha("veja", true)).toContain("em alta agora");
    expect(estruturaDaFicha("guardem", false)).toContain("passos numerados");
  });
});
