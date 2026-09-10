/**
 * E27, parte 1, item 3: `montarEntrada` com o motivo da reprovação (dois
 * motivos e nenhum). O resto do prompt (evidência, roteiros recentes) já é
 * coberto pelo golden set e pelos testes de integração de `roteiro.ts`.
 */
import { describe, expect, it } from "vitest";

import { OBJETIVOS_EM_ORDEM } from "@/ia/enums";

import { montarEntrada } from "./roteiro";

// OBJETIVOS_EM_ORDEM[2] (nao o literal, checar-texto varre este diretorio): o objetivo
// "gente me chamar para comprar" (`NOME_OBJETIVO`), o mesmo que a asserção abaixo confere.
const BASE = {
  tema: "o erro que faz a mancha voltar",
  objetivo: OBJETIVOS_EM_ORDEM[2],
  evidencias: [],
  roteirosRecentes: [],
};

describe("montarEntrada", () => {
  it("sem anguloParaEvitar, nao menciona reprovacao nenhuma", () => {
    const entrada = montarEntrada(BASE);
    expect(entrada).not.toContain("reprovou");
  });

  it("com dois motivos e motivoTexto, nomeia os dois motivos, o texto livre e trava o objetivo", () => {
    const entrada = montarEntrada({
      ...BASE,
      anguloParaEvitar: {
        gancho: "gancho antigo",
        corpo: "corpo antigo",
        motivos: ["Gancho fraco", "Muito longo"],
        motivoTexto: "comeca devagar demais",
      },
    });

    expect(entrada).toContain("O cliente reprovou a versão anterior por: Gancho fraco, Muito longo.");
    expect(entrada).toContain("O que ele escreveu: comeca devagar demais.");
    expect(entrada).toContain("continua: gente me chamar para comprar");
    expect(entrada).toContain("gancho: gancho antigo");
    expect(entrada).toContain("corpo: corpo antigo");
  });

  it("com um motivo e sem motivoTexto, nao inventa um 'o que ele escreveu'", () => {
    const entrada = montarEntrada({
      ...BASE,
      anguloParaEvitar: { gancho: "g", corpo: "c", motivos: ["Já falei disso"] },
    });

    expect(entrada).toContain("O cliente reprovou a versão anterior por: Já falei disso.");
    expect(entrada).not.toContain("O que ele escreveu");
  });
});
