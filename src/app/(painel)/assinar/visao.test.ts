/**
 * E22 PR 2: o que cada tela de `/assinar` e o cartão de Conta mostram, e quem vê cada botão (puro).
 */
import { describe, expect, it } from "vitest";

import type { SituacaoDaAssinatura } from "@/servicos/assinatura-tela";

import { botaoEhDoDono, botoesDaTela, cartaoDaConta, textosDaTela, visaoDaTela } from "./visao";

const FIM = new Date("2027-01-22T15:00:00Z");

function situacao(parcial: Partial<SituacaoDaAssinatura>): SituacaoDaAssinatura {
  return { tipo: "nunca", temAcesso: false, status: null, periodoFim: null, cancelaNoFim: false, podeAbrirOPortal: false, ...parcial };
}

describe("visaoDaTela", () => {
  it("cada situação tem a sua tela; nunca e aguardando (sem ter voltado do pagamento) mostram o convite", () => {
    expect(visaoDaTela(situacao({ tipo: "nunca" }), false)).toBe("pitch");
    expect(visaoDaTela(situacao({ tipo: "aguardando" }), false)).toBe("pitch");
    expect(visaoDaTela(situacao({ tipo: "encerrada" }), false)).toBe("encerrada");
    expect(visaoDaTela(situacao({ tipo: "cartao" }), false)).toBe("cartao");
    expect(visaoDaTela(situacao({ tipo: "atrasada", temAcesso: true }), false)).toBe("atrasada");
    expect(visaoDaTela(situacao({ tipo: "ativa", temAcesso: true }), false)).toBe("ativa");
    expect(visaoDaTela(situacao({ tipo: "cortesia", temAcesso: true }), false)).toBe("cortesia");
  });

  it("voltando do pagamento: se já vale, confirmada; senão, esperando a confirmação (sem botão de assinar)", () => {
    expect(visaoDaTela(situacao({ tipo: "ativa", temAcesso: true }), true)).toBe("confirmada");
    for (const tipo of ["nunca", "aguardando", "encerrada", "cartao"] as const) expect(visaoDaTela(situacao({ tipo }), true)).toBe("aguardando");
    expect(botoesDaTela("aguardando")).toEqual([]);
  });

  it("cortesia continua cortesia mesmo voltando do pagamento", () => {
    expect(visaoDaTela(situacao({ tipo: "cortesia", temAcesso: true }), true)).toBe("cortesia");
  });
});

describe("os botões de cada tela", () => {
  it("só o convite e o 'assinar de novo' levam ao pagamento; cartão atrasado e sem pagamento só abrem o portal (nunca uma segunda assinatura)", () => {
    expect(botoesDaTela("pitch").map((b) => b.acao)).toEqual(["assinar"]);
    expect(botoesDaTela("encerrada").map((b) => b.acao)).toEqual(["assinar"]);
    expect(botoesDaTela("cartao").map((b) => b.acao)).toEqual(["portal"]);
    expect(botoesDaTela("atrasada").map((b) => b.acao)).toEqual(["portal", "hoje"]);
    for (const v of ["cartao", "atrasada", "ativa", "confirmada", "cortesia", "aguardando"] as const) {
      expect(botoesDaTela(v).some((b) => b.acao === "assinar"), v).toBe(false);
    }
  });

  it("o botão de assinar tem o preço escrito, e o primário é sempre o primeiro", () => {
    expect(botoesDaTela("pitch")[0].rotulo).toBe("Assinar por R$ 1.191 a cada 3 meses");
    for (const v of ["pitch", "encerrada", "cartao", "atrasada", "ativa", "confirmada", "cortesia"] as const) {
      expect(botoesDaTela(v)[0].variante, v).toBe("primario");
    }
  });

  it("o que mexe em dinheiro é só do dono: assinar e portal; ir para o Hoje e ver o plano são de todos", () => {
    expect(botaoEhDoDono({ acao: "assinar", rotulo: "", variante: "primario" })).toBe(true);
    expect(botaoEhDoDono({ acao: "portal", rotulo: "", variante: "primario" })).toBe(true);
    expect(botaoEhDoDono({ acao: "hoje", rotulo: "", variante: "primario" })).toBe(false);
    expect(botaoEhDoDono({ acao: "plano", rotulo: "", variante: "primario" })).toBe(false);
  });
});

describe("os textos de cada tela", () => {
  it("o convite diz o preço por mês e o total, sem jargão", () => {
    const t = textosDaTela("pitch", situacao({}));
    expect(t.titulo).toBe("Assine para continuar");
    expect(t.frases.join(" ")).not.toMatch(/checkout|webhook|recorrente|churn|MRR/i);
  });

  it("confirmada diz até quando vale; ativa diz quando renova, ou quando termina se a pessoa cancelou", () => {
    const ativa = situacao({ tipo: "ativa", temAcesso: true, status: "active", periodoFim: FIM });
    expect(textosDaTela("confirmada", ativa).frases[0]).toContain("22 de janeiro de 2027");
    expect(textosDaTela("ativa", ativa).frases[0]).toBe("Renova em 22 de janeiro de 2027.");
    expect(textosDaTela("ativa", { ...ativa, cancelaNoFim: true }).frases[0]).toBe("Você cancelou. Vale até 22 de janeiro de 2027 e não renova.");
  });

  it("encerrada com data diz quando terminou; sem data usa a frase geral", () => {
    expect(textosDaTela("encerrada", situacao({ tipo: "encerrada", periodoFim: FIM })).frases[0]).toContain("terminou em 22 de janeiro de 2027");
    expect(textosDaTela("encerrada", situacao({ tipo: "encerrada" })).frases[0]).toContain("Assine de novo");
  });

  it("nenhum texto usa travessão, nem a palavra 'cobrança recorrente'", () => {
    const todos = (["pitch", "encerrada", "cartao", "atrasada", "aguardando", "confirmada", "ativa", "cortesia"] as const).flatMap((v) => {
      const t = textosDaTela(v, situacao({ tipo: "ativa", periodoFim: FIM }));
      return [t.titulo, ...t.frases, ...botoesDaTela(v).map((b) => b.rotulo)];
    });
    for (const texto of todos) expect(texto).not.toMatch(/[–—]/);
  });
});

describe("cartaoDaConta", () => {
  it("ativa: situação, quando renova, e o portal como botão secundário", () => {
    const c = cartaoDaConta(situacao({ tipo: "ativa", temAcesso: true, status: "active", periodoFim: FIM }));
    expect(c.situacao).toBe("Ativa");
    expect(c.data).toBe("Renova em 22 de janeiro de 2027.");
    expect(c.botoes.map((b) => [b.acao, b.variante])).toEqual([["portal", "secundario"]]);
  });

  it("atrasada e cartão: o botão é atualizar o cartão (portal); nunca assinar", () => {
    for (const tipo of ["atrasada", "cartao"] as const) {
      const c = cartaoDaConta(situacao({ tipo, status: tipo === "atrasada" ? "past_due" : "unpaid" }));
      expect(c.botoes.map((b) => b.acao)).toEqual(["portal"]);
      expect(c.botoes[0].rotulo).toBe("Atualizar o cartão");
    }
  });

  it("nunca assinou e encerrada: o botão leva ao plano (a tela de assinar), e cortesia não tem botão", () => {
    expect(cartaoDaConta(situacao({ tipo: "nunca" })).botoes.map((b) => b.acao)).toEqual(["plano"]);
    expect(cartaoDaConta(situacao({ tipo: "encerrada", status: "canceled" })).botoes.map((b) => b.acao)).toEqual(["plano"]);
    expect(cartaoDaConta(situacao({ tipo: "cortesia", temAcesso: true })).botoes).toEqual([]);
  });
});

describe("o teste grátis (E22)", () => {
  const semCartao = { dias: 7, exigeCartao: false, oferecer: true };
  const comCartao = { dias: 7, exigeCartao: true, oferecer: true };
  const emTeste = situacao({ tipo: "teste", temAcesso: true, status: "trialing", periodoFim: FIM });

  it("a marca em teste tem a sua tela, e voltando do pagamento a tela confirma o começo do teste", () => {
    expect(visaoDaTela(emTeste, false)).toBe("teste");
    expect(visaoDaTela(emTeste, true)).toBe("confirmada");
  });

  it("o convite só fala do teste para quem ainda pode ganhá-lo, com os dias escritos e sem prometer cartão que não pedimos", () => {
    expect(botoesDaTela("pitch")[0].rotulo).toBe("Assinar por R$ 1.191 a cada 3 meses");
    expect(botoesDaTela("pitch", semCartao)[0].rotulo).toBe("Começar 7 dias grátis");
    expect(textosDaTela("pitch", situacao({}), semCartao).titulo).toBe("Teste 7 dias grátis");
    expect(textosDaTela("pitch", situacao({}), { ...semCartao, oferecer: false }).titulo).toBe("Assine para continuar");
    expect(textosDaTela("pitch", situacao({}), { ...semCartao, dias: 1 }).titulo).toBe("Teste 1 dia grátis");
  });

  it("sem cartão no começo: a frase manda cadastrar o cartão e não fala de primeira cobrança; o botão principal abre o portal para isso", () => {
    const { titulo, frases } = textosDaTela("teste", emTeste, semCartao);
    expect(titulo).toBe("Você está no teste grátis");
    expect(frases).toEqual(["Seu teste grátis termina em 22 de janeiro de 2027. Para continuar, cadastre o cartão. Se você já cadastrou, está tudo certo."]);
    expect(frases.join(" ")).not.toContain("cobrança");
    expect(botoesDaTela("teste", semCartao).map((b) => [b.acao, b.rotulo, b.variante])).toEqual([
      ["portal", "Cadastrar o cartão", "primario"],
      ["hoje", "Ir para o Hoje", "secundario"],
    ]);
  });

  it("com cartão no começo: Você está no teste grátis até a data, e a primeira cobrança é na mesma data", () => {
    expect(textosDaTela("teste", emTeste, comCartao).frases).toEqual(["Você está no teste grátis até 22 de janeiro de 2027. Se não cancelar, a primeira cobrança é em 22 de janeiro de 2027."]);
    expect(botoesDaTela("teste", comCartao).map((b) => b.acao)).toEqual(["hoje", "portal"]);
  });

  it("quem cancelou durante o teste lê que nada será cobrado, e o teste sem data diz o que dá para dizer", () => {
    expect(textosDaTela("teste", { ...emTeste, cancelaNoFim: true }, comCartao).frases).toEqual(["Você cancelou. O teste grátis vai até 22 de janeiro de 2027 e nada será cobrado."]);
    expect(textosDaTela("teste", { ...emTeste, periodoFim: null }, comCartao).frases[0]).toContain("no fim do teste");
  });

  it("o cartão de Conta mostra Teste grátis, a frase e o botão certo para cada modo", () => {
    const sem = cartaoDaConta(emTeste, false);
    expect(sem.situacao).toBe("Teste grátis");
    expect(sem.data).toContain("cadastre o cartão");
    expect(sem.botoes.map((b) => b.rotulo)).toEqual(["Cadastrar o cartão"]);
    const com = cartaoDaConta(emTeste, true);
    expect(com.data).toContain("a primeira cobrança é em");
    expect(com.botoes.map((b) => b.rotulo)).toEqual(["Gerenciar a assinatura"]);
  });
});
