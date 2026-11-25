import { describe, expect, it } from "vitest";

import { LIMITES_DA_ANIMACAO } from "@/config/animacao";

import { animacaoLiberadaParaMarca, contasDaAnimacao } from "./acesso";
import { cenasDosParagrafos } from "./cenas";
import { montarLinhaDoTempo } from "./montador";

describe("cenasDosParagrafos", () => {
  it("cada frase vira uma cena, na ordem do roteiro, e frases muito curtas se juntam", () => {
    const cenas = cenasDosParagrafos(["Você erra isso todo dia? Pare agora.", "Eu mostro como lavar a louça em um minuto, sem gastar nada e sem perder tempo com isso."]);
    expect(cenas.map((c) => c.texto)).toEqual(["Você erra isso todo dia? Pare agora.", "Eu mostro como lavar a louça em um minuto, sem gastar nada e sem perder tempo com isso."]);
  });

  it("frase maior que o bloco é cortada, de preferência depois da vírgula, e cada cena cabe no limite", () => {
    const longa = `${"palavra ".repeat(12).trim()}, ${"outra ".repeat(20).trim()}.`;
    const cenas = cenasDosParagrafos([longa]);
    expect(cenas.length).toBeGreaterThan(1);
    for (const c of cenas) expect(c.texto.length).toBeLessThanOrEqual(LIMITES_DA_ANIMACAO.maxCaracteresPorCena);
    expect(cenas[0].texto.endsWith(",")).toBe(true);
    expect(cenas.map((c) => c.texto).join(" ")).toBe(longa);
  });

  it("roteiro enorme perde cenas do miolo e mantém o gancho e a chamada, dentro de 24 cenas e 60 segundos", () => {
    const paragrafos = ["GANCHO do video que prende a pessoa nos primeiros segundos de tela.", ...Array.from({ length: 80 }, (_, i) => `Frase de numero ${i} do corpo que explica um passo do assunto com calma.`), "CHAMADA final: chame no WhatsApp hoje."];
    const cenas = cenasDosParagrafos(paragrafos);
    expect(cenas.length).toBeLessThanOrEqual(LIMITES_DA_ANIMACAO.maxCenas);
    expect(cenas[0].texto).toContain("GANCHO");
    expect(cenas[cenas.length - 1].texto).toContain("CHAMADA");
    expect(montarLinhaDoTempo(cenas).duracaoS).toBeLessThanOrEqual(LIMITES_DA_ANIMACAO.duracaoMaximaTotalS);
  });

  it("sem texto, sem cena", () => {
    expect(cenasDosParagrafos([])).toEqual([]);
    expect(cenasDosParagrafos(["   ", ""])).toEqual([]);
  });

  it("tira o que não se desenha e nunca devolve marcação interpretada: o texto segue literal para o molde escapar", () => {
    const cenas = cenasDosParagrafos(["<script>alert(1)</script> olá"]);
    expect(cenas).toEqual([{ texto: "<script>alert(1)</script> olá" }]);
  });
});

describe("acesso à animação", () => {
  const anterior = { ativa: process.env.ANIMACAO_ATIVA, contas: process.env.ANIMACAO_CONTAS };
  const restaurar = () => {
    if (anterior.ativa === undefined) delete process.env.ANIMACAO_ATIVA;
    else process.env.ANIMACAO_ATIVA = anterior.ativa;
    if (anterior.contas === undefined) delete process.env.ANIMACAO_CONTAS;
    else process.env.ANIMACAO_CONTAS = anterior.contas;
  };

  it("lê a lista a cada chamada: ids válidos, separados por vírgula, o resto é ignorado", () => {
    try {
      process.env.ANIMACAO_CONTAS = " 3, 7 ,abc,,-2,0, 12 ";
      expect(contasDaAnimacao()).toEqual([3, 7, 12]);
      process.env.ANIMACAO_CONTAS = "";
      expect(contasDaAnimacao()).toEqual([]);
    } finally {
      restaurar();
    }
  });

  it("só libera com a chave ligada E o id na lista; o id na lista sem a chave não libera", () => {
    try {
      process.env.ANIMACAO_CONTAS = "5";
      delete process.env.ANIMACAO_ATIVA;
      expect(animacaoLiberadaParaMarca(5)).toBe(false);
      process.env.ANIMACAO_ATIVA = "0";
      expect(animacaoLiberadaParaMarca(5)).toBe(false);
      process.env.ANIMACAO_ATIVA = "1";
      expect(animacaoLiberadaParaMarca(5)).toBe(true);
      expect(animacaoLiberadaParaMarca(6)).toBe(false);
      process.env.ANIMACAO_CONTAS = "6";
      expect(animacaoLiberadaParaMarca(5)).toBe(false);
    } finally {
      restaurar();
    }
  });
});
