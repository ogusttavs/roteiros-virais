import { describe, expect, it } from "vitest";

import { OBJETIVOS_EM_ORDEM } from "../enums";
import { construirSaidaMock } from "../mock";

import { LEMBRETE_ACENTUACAO, montarEntrada, montarSistemaEstavel, nivel, schema } from "./notaDaVersao";

const BASE = {
  tema: "o que fazer quando a mancha volta",
  // Por posição, não pelo nome interno: o checar-texto varre este diretório (mesmo cuidado de roteiro.test.ts).
  objetivo: OBJETIVOS_EM_ORDEM[2],
  persona: "negocio" as const,
  formato: "reels" as const,
  estilo: "falado" as const,
  duracaoS: 28,
  titulo: "A mancha que volta",
  gancho: "Tira a mancha e ela volta em dois dias?",
  corpo: "Quase sempre é o enxágue, não o produto.",
  fechamento: "Enxague até a água sair clara.",
  chamadaFinal: "Chama no WhatsApp que eu te mando o kit.",
  cartoes: null,
  legenda: null,
};

describe("o juiz das versões do roteiro", () => {
  it("é uma chamada no modelo barato, com a régua inteira no texto estável (igual para todas as versões)", () => {
    expect(nivel).toBe("barato");
    const sistema = montarSistemaEstavel({ perfilCompilado: "vende kit tira-mancha" });
    expect(sistema).toContain("vende kit tira-mancha");
    expect(sistema).toContain("viralizar");
    expect(sistema).toContain("chamarem");
    expect(sistema).toContain("lembrarem");
    expect(sistema).toContain("0 a 10");
    // A régua não depende da versão: duas montagens iguais dão o mesmo texto (cache do prompt estável).
    expect(montarSistemaEstavel({ perfilCompilado: "vende kit tira-mancha" })).toBe(sistema);
  });

  it("a entrada leva o roteiro inteiro de uma versão só e diz qual objetivo vale", () => {
    const entrada = montarEntrada(BASE);
    expect(entrada).toContain("Título do roteiro: A mancha que volta");
    expect(entrada).toContain(BASE.gancho);
    expect(entrada).toContain(BASE.chamadaFinal);
    expect(entrada).toContain("que te chamem para comprar");
    expect(entrada).toContain("Reels falado, cerca de 28 segundos");
    expect(montarEntrada({ ...BASE, objetivo: OBJETIVOS_EM_ORDEM[0] })).toContain("que mais gente te conheça");
    expect(montarEntrada({ ...BASE, objetivo: OBJETIVOS_EM_ORDEM[1] })).toContain("que lembrem de você");
  });

  it("em Story ou vídeo sem fala, lê os cartões em vez do gancho e do meio", () => {
    const cartoes = [
      { oQueFalar: "", oQueMostrar: "a mancha voltando na parede", textoNaTela: "ela volta?" },
      { oQueFalar: "Fala o que mudou", oQueMostrar: "o enxágue", textoNaTela: "enxágue" },
    ];
    const entrada = montarEntrada({ ...BASE, formato: "story", cartoes });
    expect(entrada).toContain("Formato: Story");
    expect(entrada).toContain("Cartão 1: mostra: a mancha voltando na parede; na tela: ela volta?");
    expect(entrada).toContain("Cartão 2: fala: Fala o que mudou; mostra: o enxágue; na tela: enxágue");
    expect(entrada).not.toContain("Gancho (3 primeiros segundos)");
    expect(montarEntrada({ ...BASE, estilo: "sem_fala", cartoes })).toContain("Reels sem fala");
  });

  it("o simulador devolve três notas válidas pelo schema, as mesmas para a mesma entrada", () => {
    const entrada = `${montarEntrada(BASE)}\n\n${LEMBRETE_ACENTUACAO}`;
    const a = schema.parse(construirSaidaMock("notaDaVersao", entrada, ""));
    const b = schema.parse(construirSaidaMock("notaDaVersao", entrada, ""));
    expect(a).toEqual(b);
    for (const n of [a.viralizar, a.chamarem, a.lembrarem]) {
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(9.4);
    }
    const outra = schema.parse(construirSaidaMock("notaDaVersao", entrada.replace("mancha", "gordura"), ""));
    expect([outra.viralizar, outra.chamarem, outra.lembrarem]).not.toEqual([a.viralizar, a.chamarem, a.lembrarem]);
  });

  it("a marca [notas a b c] dá as notas exatas", () => {
    const saida = schema.parse(construirSaidaMock("notaDaVersao", `${montarEntrada({ ...BASE, titulo: "x [notas 9.1 8.2 7.6]" })}`, ""));
    expect([saida.viralizar, saida.chamarem, saida.lembrarem]).toEqual([9.1, 8.2, 7.6]);
  });
});
