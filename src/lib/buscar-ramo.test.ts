import { describe, expect, it } from "vitest";

import { GRUPOS_DE_RAMO, RAMOS_DO_CATALOGO } from "@/config/ramos";

import { buscarRamos, normalizarBusca, primeiroRamoDosResultados, ramoMaisProximo, ramosEmOrdemDeTela } from "./buscar-ramo";

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

/**
 * Achados da revisão independente da E45 PR 1: antes, todas as palavras digitadas tinham de casar com o mesmo ramo, e uma palavra que
 * o catálogo não conhece ("beleza", "trainer", "carros") esvaziava a lista, inclusive no meio da digitação; plural e feminino não
 * achavam nada ("dentistas", "cabeleireira").
 */
describe("buscarRamos: palavra que o catálogo não conhece, plural e feminino", () => {
  it.each([
    ["salão de beleza", 16],
    ["personal trainer", 20],
    ["oficina de carros", 7],
    ["clínica de nutrição", 12],
    ["fotógrafo de casamento", 35],
    ["escola de dança", 22],
    ["salão de unhas", 18],
    ["escritório de contabilidade", 33],
  ])("'%s' tem o ramo %i em primeiro (a palavra que o catálogo não conhece não esvazia a lista)", (consulta, numero) => {
    expect(numeros(consulta)[0]).toBe(numero);
  });

  it.each([
    ["dentistas", 10],
    ["cabeleireira", 16],
    ["cabeleireiras", 16],
    ["advogados", 32],
    ["manicures", 18],
    ["médica", 11],
    ["professora", 34],
    ["roupas", 27],
    ["restaurantes", 23],
    ["psicólogos", 13],
    ["arquiteto", 3],
    ["contadora", 33],
    ["pintora", 2],
    ["fotógrafa", 35],
    ["sapatos", 27],
    ["loja de roupas", 27],
  ])("o plural e o outro gênero também acham: '%s' tem o ramo %i em primeiro", (consulta, numero) => {
    expect(numeros(consulta)[0]).toBe(numero);
  });

  it("uma consulta que duas coisas disputam mostra as duas: 'festa infantil' traz Eventos e festas e Infantil e brinquedos", () => {
    expect(numeros("festa infantil")).toEqual(expect.arrayContaining([29, 36]));
  });

  it("digitando 'salão de beleza' letra a letra, a lista nunca fica vazia depois da primeira palavra, e o ramo certo fica em primeiro", () => {
    const digitado = "salão de beleza";
    for (let n = "salão".length; n <= digitado.length; n += 1) {
      const parcial = digitado.slice(0, n);
      expect(numeros(parcial).length, `"${parcial}" esvaziou a lista`).toBeGreaterThan(0);
      expect(numeros(parcial)[0], `"${parcial}"`).toBe(16);
    }
  });

  it("o começo de uma palavra de ligação ainda sendo escrita não esvazia a lista: 'salão d', 'personal t'", () => {
    expect(numeros("salão d")[0]).toBe(16);
    expect(numeros("loja d")).toContain(8);
  });

  it("quando a busca exata acha ramo, o plural e a busca parcial não entram (não mudam o que já funcionava)", () => {
    expect(numeros("loja de carros")).toContain(8);
    expect(numeros("loja de carros")).not.toContain(30);
    expect(numeros("limpeza de pele")).not.toContain(1);
  });

  it("palavras que nada no catálogo conhece continuam sem resultado (é aí que entra o 'Não achei o meu')", () => {
    expect(buscarRamos("xyzw")).toEqual([]);
    expect(buscarRamos("xyzw abcd")).toEqual([]);
  });

  it("o nome do grupo também leva ao ramo: 'beleza' mostra os quatro ramos do grupo Beleza e estética, 'saúde' os seis de Saúde", () => {
    expect(numeros("beleza")).toEqual(expect.arrayContaining([16, 17, 18, 19]));
    expect(numeros("saude")).toEqual(expect.arrayContaining([10, 11, 12, 13, 14, 15]));
    expect(numeros("comida")).toEqual(expect.arrayContaining([23, 24, 25, 26]));
  });
});

describe("buscarRamos: o que vale mais, preso por exemplos", () => {
  it("o nome do ramo vale mais que as palavras, que valem mais que os exemplos, que valem mais que o nome do grupo", () => {
    // 'mecanica': nos exemplos do 7 (Mecânica...), e em palavra nenhuma; 'mecanico' é palavra do 7. 'pet': no nome do 15.
    expect(numeros("pet")[0]).toBe(15);
    // 'corrida' é palavra do 9 (e do 21); 'automobilismo' é nome do 9: o nome inteiro fica em primeiro.
    expect(numeros("automobilismo")[0]).toBe(9);
    // Só no nome do grupo ('esporte'): aparece, mas atrás de quem tem a palavra no nome ou nas palavras.
    const esporte = numeros("esporte");
    expect(esporte[0]).toBe(21);
    expect(esporte).toEqual(expect.arrayContaining([20, 21, 22]));
  });

  it("a palavra inteira vale mais que o começo dela: 'bar' põe Bar, café e bebidas antes de Barbearia", () => {
    const resultado = numeros("bar");
    expect(resultado).toContain(25);
    expect(resultado).toContain(16);
    expect(resultado.indexOf(25)).toBeLessThan(resultado.indexOf(16));
  });

  it("a frase inteira no começo de uma palavra de busca vale mais que as palavras soltas: 'limpeza de pele' é Estética e pele", () => {
    expect(numeros("limpeza de pele")).toEqual([17]);
  });
});

/** E45 PR 2: o ramo provisório de quem escolheu "Não achei o meu". */
describe("ramoMaisProximo", () => {
  it.each([
    ["criação de abelhas", "agro-e-campo"],
    ["clínica veterinária", "veterinaria-e-pet"],
    ["salão de beleza", "cabelo-e-barbearia"],
    ["dentistas", "odontologia"],
    ["personal trainer", "academia-e-treino"],
    ["fazenda de abelhas", "agro-e-campo"],
  ])("%s cai em %s", (texto, slug) => {
    expect(ramoMaisProximo(texto)?.slug).toBe(slug);
  });

  it("devolve nulo quando nada casa, e para texto que não diz nada (vazio, pontuação, só ligação, fragmentos)", () => {
    expect(ramoMaisProximo("xyzw abcd")).toBeNull();
    expect(ramoMaisProximo("tatuador qqq")).toBeNull();
    expect(ramoMaisProximo("")).toBeNull();
    expect(ramoMaisProximo("   ")).toBeNull();
    expect(ramoMaisProximo("---")).toBeNull();
    expect(ramoMaisProximo("de")).toBeNull();
    expect(ramoMaisProximo("a b")).toBeNull();
    expect(ramoMaisProximo("d")).toBeNull();
  });

  it("é o mesmo primeiro resultado que a lista da tela mostra (a busca e o palpite não discordam)", () => {
    for (const texto of ["loja de roupas", "pilotagem de kart", "clínica de nutrição", "criação de abelhas"]) {
      expect(ramoMaisProximo(texto)?.slug).toBe(primeiroRamoDosResultados(buscarRamos(texto))?.slug);
    }
  });
});
