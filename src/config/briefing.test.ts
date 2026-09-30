import { describe, expect, it } from "vitest";

import { dadosFixosDoBriefing, perguntasDoBriefing } from "./briefing";

const TIPOS = ["negocio", "pessoa"] as const;

/** brief-frontend.md 6.2, "Ajuste de 06/09/2026": a lista de notas precisa de um rótulo curto por pergunta. */
describe("perguntasDoBriefing", () => {
  it("cada tipo tem doze perguntas", () => {
    for (const tipo of TIPOS) {
      expect(perguntasDoBriefing(tipo)).toHaveLength(12);
    }
  });

  it("toda pergunta tem rotuloCurto, não vazio", () => {
    for (const tipo of TIPOS) {
      for (const pergunta of perguntasDoBriefing(tipo)) {
        expect(pergunta.rotuloCurto.trim().length).toBeGreaterThan(0);
      }
    }
  });

  /**
   * P1, item 1: os mesmos ids, blocos e pesos nos dois tipos, para a lista
   * de notas, a barra de blocos, o blocoInicial e as avaliações guardadas
   * por id continuarem iguais.
   */
  it("os dois tipos têm os mesmos ids, nos mesmos blocos e com os mesmos pesos", () => {
    const negocio = perguntasDoBriefing("negocio");
    const pessoa = perguntasDoBriefing("pessoa");
    for (const pergunta of negocio) {
      const correspondente = pessoa.find((p) => p.id === pergunta.id);
      expect(correspondente).toBeDefined();
      expect(correspondente!.bloco).toBe(pergunta.bloco);
      expect(correspondente!.peso).toBe(pergunta.peso);
    }
  });

  it("peso 2 exatamente em P1, P5, P9 e P11, nos dois tipos", () => {
    const pesoEsperado = {
      p1: 2,
      p2: 1,
      p3: 1,
      p4: 1,
      p5: 2,
      p6: 1,
      p7: 1,
      p8: 1,
      p9: 2,
      p10: 1,
      p11: 2,
      p12: 1,
    };
    for (const tipo of TIPOS) {
      const pesos = Object.fromEntries(perguntasDoBriefing(tipo).map((p) => [p.id, p.peso]));
      expect(pesos).toEqual(pesoEsperado);
    }
  });

  it("os rótulos curtos do negócio são exatamente os do brief-frontend.md", () => {
    const rotulos = Object.fromEntries(perguntasDoBriefing("negocio").map((p) => [p.id, p.rotuloCurto]));
    expect(rotulos).toEqual({
      p1: "o que você faz",
      p2: "o que mais vende",
      p3: "o que faz diferente",
      p4: "sua cliente",
      p5: "o medo dela",
      p6: "perguntas repetidas",
      p7: "o que quer que aconteça",
      p8: "onde posta hoje",
      p9: "suas frases",
      p10: "o que nunca diria",
      p11: "o que dá para mostrar",
      p12: "referências e concorrentes",
    });
  });

  /** P1, item 1: os rótulos exatos sugeridos no PROXIMO.md para a pessoa. */
  it("os rótulos curtos da pessoa são os do PROXIMO.md", () => {
    const rotulos = Object.fromEntries(perguntasDoBriefing("pessoa").map((p) => [p.id, p.rotuloCurto]));
    expect(rotulos).toEqual({
      p1: "quem você é",
      p2: "do que quer ser lembrado",
      p3: "a sua virada",
      p4: "quem te segue",
      p5: "o que querem ver",
      p6: "suas opiniões",
      p7: "o que quer que aconteça",
      p8: "onde posta hoje",
      p9: "suas frases e o tom",
      p10: "o que fica fora",
      p11: "a sua semana na câmera",
      p12: "referências",
    });
  });

  /** P1: os enunciados da pessoa batem literalmente com briefing-e-rubricas.md, secao 2b. */
  it("os enunciados da pessoa são exatamente os do documento, para P1 e P12", () => {
    const enunciados = Object.fromEntries(perguntasDoBriefing("pessoa").map((p) => [p.id, p.enunciado]));
    expect(enunciados.p1).toBe(
      "Quem é você e o que você faz hoje? Conte como se fosse para alguém que nunca ouviu falar de você: o que você faz de verdade no dia, há quanto tempo, de onde você vem.",
    );
    expect(enunciados.p12).toBe(
      "Cite dois ou três perfis que você admira (com @) e dois ou três que fazem algo parecido com o que você quer fazer (com @). Em uma frase, por que cada um.",
    );
  });

  /**
   * P1, P2 e P3 (bloco "Sobre você") nunca pedem produto, preço ou
   * diferencial: quem responde pode nao ter negocio nenhum (secao 2b,
   * "Para quem serve"). P7 e P11 citam "negócios" legitimamente (os
   * negócios da própria pessoa), entao a checagem e so nas tres primeiras.
   */
  it("P1, P2 e P3 da pessoa nunca pedem diferencial nem preco de produto", () => {
    for (const id of ["p1", "p2", "p3"]) {
      const pergunta = perguntasDoBriefing("pessoa").find((p) => p.id === id)!;
      const texto = pergunta.enunciado.toLowerCase();
      expect(texto).not.toContain("negócio");
      expect(texto).not.toContain("diferencial");
      expect(texto).not.toContain("preço");
    }
  });
});

describe("dadosFixosDoBriefing", () => {
  it("pessoa: rótulo Nome, quem aparece fixo e escondido, sem a opção de vender", () => {
    const dados = dadosFixosDoBriefing("pessoa");
    expect(dados.nome.rotulo).toBe("Nome");
    expect(dados.quemGrava.fixoEmPropriaPessoa).toBe(true);
    expect(dados.persona.opcoes.map((opcao) => opcao.valor)).not.toContain("negocio");
  });

  it("negócio: continua com o rótulo e as opções de sempre", () => {
    const dados = dadosFixosDoBriefing("negocio");
    expect(dados.nome.rotulo).toBe("Nome do negócio");
    expect(dados.quemGrava.fixoEmPropriaPessoa).toBeUndefined();
    expect(dados.persona.opcoes.map((opcao) => opcao.valor)).toContain("negocio");
  });
});
