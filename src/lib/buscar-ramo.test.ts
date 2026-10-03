import { describe, expect, it } from "vitest";

import { GRUPOS_DE_RAMO, RAMOS_DO_CATALOGO } from "@/config/ramos";

import { buscarRamos, normalizarBusca, primeiroRamoDosResultados, ramosEmOrdemDeTela } from "./buscar-ramo";

function numeros(consulta: string): number[] {
  return ramosEmOrdemDeTela(buscarRamos(consulta)).map((r) => r.numero);
}

describe("normalizarBusca", () => {
  it("tira acento, maiúscula e pontuação, e junta os espaços", () => {
    expect(normalizarBusca("  Estética   Automotiva ")).toBe("estetica automotiva");
    expect(normalizarBusca("Jiu-Jitsu")).toBe("jiu jitsu");
    expect(normalizarBusca("Cílios, Lash!")).toBe("cilios lash");
    expect(normalizarBusca("***")).toBe("");
  });
});

describe("buscarRamos: a prova da ordem do Fable (as quatro palavras caem no ramo certo)", () => {
  it.each([
    ["dentista", 10],
    ["piloto", 9],
    ["envelopamento", 6],
    ["dieta", 12],
  ])("'%s' tem o ramo %i como primeiro resultado", (palavra, numero) => {
    expect(primeiroRamoDosResultados(buscarRamos(palavra))?.numero).toBe(numero);
  });
});

describe("buscarRamos: começo de palavra, sem acento e sem maiúscula", () => {
  it("uma letra já mostra resultados, de vários grupos, sem quebrar", () => {
    const grupos = buscarRamos("d");
    expect(grupos.length).toBeGreaterThan(3);
    expect(numeros("d").length).toBeGreaterThan(10);
  });

  it("o começo da palavra basta: 'dent' acha Odontologia, 'envelop' acha Estética automotiva", () => {
    expect(numeros("dent")).toContain(10);
    expect(numeros("envelop")[0]).toBe(6);
  });

  it("o meio da palavra não casa: 'ista' não acha dentista", () => {
    expect(numeros("ista")).not.toContain(10);
  });

  it("sem acento e sem maiúscula: 'ESTETICA' e 'estética' dão o mesmo", () => {
    expect(numeros("ESTETICA")).toEqual(numeros("estética"));
    expect(numeros("estetica")).toEqual(expect.arrayContaining([6, 17]));
    expect(numeros("otica")).toContain(28);
    expect(numeros("ótica")).toContain(28);
  });

  it("palavra com hífen casa nos dois jeitos: 'jiu' e 'jiu-j' acham Esportes e lutas", () => {
    expect(numeros("jiu")[0]).toBe(21);
    expect(numeros("jiu-j")[0]).toBe(21);
    expect(numeros("jiu jitsu")[0]).toBe(21);
  });

  it("acha pela linha de exemplos, não só pelo nome e pelas palavras", () => {
    // "hidraulica" só está nos exemplos do 2.
    expect(numeros("hidraulica")).toContain(2);
  });

  it("várias palavras: todas precisam casar com o mesmo ramo, em qualquer ordem", () => {
    expect(numeros("banho e t")).toEqual([15]);
    expect(numeros("tosa banho")).toEqual([15]);
    expect(numeros("loja de carros")[0]).toBe(8);
    expect(numeros("loja de carros")).not.toContain(30);
    expect(numeros("limpeza de pele")[0]).toBe(17);
    expect(numeros("limpeza de pele")).not.toContain(1);
  });

  it("palavra de ligação sozinha ainda busca (a pessoa pode estar no meio da frase)", () => {
    expect(numeros("de").length).toBeGreaterThan(0);
  });

  it("sem resultado devolve vazio (é aí que entra o 'Não achei o meu')", () => {
    expect(buscarRamos("xyzw")).toEqual([]);
    expect(primeiroRamoDosResultados(buscarRamos("xyzw"))).toBeNull();
  });
});

describe("buscarRamos: a ordem na tela", () => {
  it("o nome inteiro do ramo traz o próprio ramo em primeiro, para os 44 ramos", () => {
    for (const ramo of RAMOS_DO_CATALOGO) {
      expect(primeiroRamoDosResultados(buscarRamos(ramo.nome))?.slug, ramo.nome).toBe(ramo.slug);
    }
  });

  it("cada palavra de busca de um ramo traz esse ramo na lista, para os 44 ramos", () => {
    for (const ramo of RAMOS_DO_CATALOGO) {
      for (const palavra of ramo.palavras) {
        expect(
          ramosEmOrdemDeTela(buscarRamos(palavra)).map((r) => r.slug),
          `${ramo.slug}: ${palavra}`,
        ).toContain(ramo.slug);
      }
    }
  });

  it("cada ramo aparece uma vez só, e dentro do seu grupo", () => {
    const grupos = buscarRamos("e");
    const slugs = ramosEmOrdemDeTela(grupos).map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const g of grupos) for (const r of g.ramos) expect(r.grupo).toBe(g.grupo.slug);
  });

  it("o nome vale mais que as palavras e os exemplos: 'estetica' põe primeiro um dos dois ramos que têm Estética no nome", () => {
    const primeiros = ramosEmOrdemDeTela(buscarRamos("estetica"))
      .slice(0, 2)
      .map((r) => r.numero)
      .sort((a, b) => a - b);
    expect(primeiros).toEqual([6, 17]);
  });

  it("consulta vazia (ou só pontuação) devolve o catálogo inteiro, nos 9 grupos e na ordem do documento", () => {
    for (const vazia of ["", "   ", "---"]) {
      const grupos = buscarRamos(vazia);
      expect(grupos.map((g) => g.grupo.slug)).toEqual(GRUPOS_DE_RAMO.map((g) => g.slug));
      expect(ramosEmOrdemDeTela(grupos).map((r) => r.numero)).toEqual(Array.from({ length: 44 }, (_, i) => i + 1));
    }
  });
});
