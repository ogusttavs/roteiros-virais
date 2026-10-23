import { describe, expect, it } from "vitest";

import { podeCircularPadrao, type ContribuicaoDeMarca } from "./padrao-agregado";

/** n marcas, cada uma de um dono diferente, com `videos` vídeos cada. */
function marcas(n: number, videos: number, aPartirDe = 1): ContribuicaoDeMarca[] {
  return Array.from({ length: n }, (_, i) => ({ marcaId: aPartirDe + i, donoId: `dono-${aPartirDe + i}`, videos }));
}

describe("podeCircularPadrao (a porta do que circula entre marcas)", () => {
  it("5 marcas de 5 donos, 2 vídeos cada: pode", () => {
    expect(podeCircularPadrao(marcas(5, 2))).toEqual({ pode: true });
  });

  it("nenhuma marca ou uma só: nunca (o padrão seria o conteúdo dela)", () => {
    expect(podeCircularPadrao([])).toEqual({ pode: false, motivo: "poucas_marcas" });
    expect(podeCircularPadrao(marcas(1, 50))).toEqual({ pode: false, motivo: "poucas_marcas" });
  });

  it("4 marcas, por mais vídeos que tenham, não bastam", () => {
    expect(podeCircularPadrao(marcas(4, 100))).toEqual({ pode: false, motivo: "poucas_marcas" });
  });

  it("marca sem nenhum vídeo no padrão não conta como marca", () => {
    expect(podeCircularPadrao([...marcas(4, 3), { marcaId: 99, donoId: "dono-99", videos: 0 }])).toEqual({ pode: false, motivo: "poucas_marcas" });
  });

  it("5 marcas da mesma pessoa contam como um dono só: não circula", () => {
    const daMesmaPessoa = marcas(5, 3).map((c) => ({ ...c, donoId: "uma-pessoa" }));
    expect(podeCircularPadrao(daMesmaPessoa)).toEqual({ pode: false, motivo: "poucos_donos" });
  });

  it("5 marcas de 2 donos: ainda não circula; de 3 donos: circula", () => {
    const doisDonos = marcas(5, 3).map((c, i) => ({ ...c, donoId: i < 3 ? "dono-a" : "dono-b" }));
    expect(podeCircularPadrao(doisDonos)).toEqual({ pode: false, motivo: "poucos_donos" });
    const tresDonos = marcas(5, 3).map((c, i) => ({ ...c, donoId: i < 2 ? "dono-a" : i < 4 ? "dono-b" : "dono-c" }));
    expect(podeCircularPadrao(tresDonos)).toEqual({ pode: true });
  });

  it("menos de 10 vídeos no total: não circula", () => {
    expect(podeCircularPadrao(marcas(5, 1))).toEqual({ pode: false, motivo: "poucos_videos" });
  });

  it("uma marca com mais da metade dos vídeos identifica o padrão: não circula", () => {
    const desigual = [...marcas(4, 1), { marcaId: 50, donoId: "dono-50", videos: 20 }];
    expect(podeCircularPadrao(desigual)).toEqual({ pode: false, motivo: "uma_marca_domina" });
  });

  it("exatamente metade dos vídeos numa marca ainda passa; um vídeo a mais, não", () => {
    // 4 marcas com 2 vídeos (8) e uma com 8: 8 de 16 é a metade.
    const metade = [...marcas(4, 2), { marcaId: 70, donoId: "dono-70", videos: 8 }];
    expect(podeCircularPadrao(metade)).toEqual({ pode: true });
    const passou = [...marcas(4, 2), { marcaId: 70, donoId: "dono-70", videos: 9 }];
    expect(podeCircularPadrao(passou)).toEqual({ pode: false, motivo: "uma_marca_domina" });
  });

  it("a mesma marca contribuindo em duas linhas soma, não vira duas marcas", () => {
    const duplicada = [...marcas(3, 3), { marcaId: 10, donoId: "dono-10", videos: 2 }, { marcaId: 10, donoId: "dono-10", videos: 2 }];
    expect(podeCircularPadrao(duplicada)).toEqual({ pode: false, motivo: "poucas_marcas" });
  });
});
