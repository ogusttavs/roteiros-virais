/** As cinco fichas (E49 PR 1): o mapa ficha para objetivo, a ficha padrão de quem só tem o objetivo, e o rótulo que a tela mostra. */
import { describe, expect, it } from "vitest";

import { ehFicha, FICHAS_EM_ORDEM, fichaPadraoDoObjetivo, objetivoDaFicha, ROTULO_PARA_QUE, rotuloParaQue, ROTULO_STORY_PARA_QUEM } from "./fichas";

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
