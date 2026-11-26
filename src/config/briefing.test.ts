import { describe, expect, it } from "vitest";

import {
  dadosFixosDoBriefing,
  ENUNCIADO_P12_ANTES_DA_SEPARACAO,
  perguntasDoBriefing,
  TOTAL_PERGUNTAS,
  VERSAO_P12_SEPARADA,
} from "./briefing";

const TIPOS = ["negocio", "pessoa"] as const;

/** brief-frontend.md 6.2, "Ajuste de 06/09/2026": a lista de notas precisa de um rótulo curto por pergunta. */
describe("perguntasDoBriefing", () => {
  it("cada tipo tem treze perguntas (E76 PR 2: a P12 virou duas)", () => {
    for (const tipo of TIPOS) {
      expect(perguntasDoBriefing(tipo)).toHaveLength(13);
    }
    expect(TOTAL_PERGUNTAS).toBe(13);
  });

  it("a soma dos pesos continua 16: a P12 e a P13 dividem o peso 1 da P12 antiga, e a média e a meta não mudam", () => {
    for (const tipo of TIPOS) {
      expect(perguntasDoBriefing(tipo).reduce((soma, p) => soma + p.peso, 0)).toBe(16);
    }
  });

  /** E76 PR 2: os concorrentes (ou os perfis parecidos, na pessoa) na P12, os admirados na P13, cada um com a sua lista de @. */
  it("a lista de @ dos concorrentes fica na P12 e a dos admirados na P13; nenhuma outra pergunta tem lista", () => {
    for (const tipo of TIPOS) {
      const comLista = perguntasDoBriefing(tipo).filter((p) => p.perfisCitados);
      expect(comLista.map((p) => [p.id, p.perfisCitados])).toEqual([
        ["p12", "concorrente"],
        ["p13", "admira"],
      ]);
      for (const p of comLista) expect(p.enunciadoCampo?.trim().length).toBeGreaterThan(0);
    }
  });

  it("a P12 nova leva a versão da separação, e o enunciado de antes fica guardado para ler a resposta antiga", () => {
    for (const tipo of TIPOS) {
      const p12 = perguntasDoBriefing(tipo).find((p) => p.id === "p12")!;
      expect(p12.versao).toBe(VERSAO_P12_SEPARADA);
      expect(p12.enunciado).not.toBe(ENUNCIADO_P12_ANTES_DA_SEPARACAO[tipo]);
      expect(p12.enunciado.toLowerCase()).not.toContain("admira");
      const p13 = perguntasDoBriefing(tipo).find((p) => p.id === "p13")!;
      expect(p13.enunciado.toLowerCase()).toContain("admira");
      expect(p13.versao).toBeUndefined();
      // Só a P12 mudou de sentido; as outras nunca levam versão.
      expect(perguntasDoBriefing(tipo).filter((p) => p.versao !== undefined).map((p) => p.id)).toEqual(["p12"]);
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

  it("peso 2 exatamente em P1, P5, P9 e P11, meio na P12 e na P13, nos dois tipos", () => {
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
      p12: 0.5,
      p13: 0.5,
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
      p12: "concorrentes",
      p13: "perfis que admira",
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
      p12: "perfis parecidos",
      p13: "perfis que admira",
    });
  });

  /** P1: os enunciados da pessoa batem literalmente com briefing-e-rubricas.md, secao 2b. */
  it("os enunciados da pessoa são exatamente os do documento, para P1, P12 e P13", () => {
    const enunciados = Object.fromEntries(perguntasDoBriefing("pessoa").map((p) => [p.id, p.enunciado]));
    expect(enunciados.p1).toBe(
      "Quem é você e o que você faz hoje? Conte como se fosse para alguém que nunca ouviu falar de você: o que você faz de verdade no dia, há quanto tempo, de onde você vem.",
    );
    expect(enunciados.p12).toBe("Quais perfis são parecidos com o seu, e o que eles fazem que você faria diferente?");
    expect(enunciados.p13).toBe("Quais são os perfis que você admira, e o que gosta em cada um?");
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
