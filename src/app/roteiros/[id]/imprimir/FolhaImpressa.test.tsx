/**
 * A folha impressa com as marcas de fala (E41 2c): o texto que sai no papel é o do roteiro, o tom aparece ao lado do tempo do bloco, e a legenda curta vem no pé da imagem (no PDF ela vem
 * no pé de cada página, escrita pelo Chromium: `chromium-de-impressao.test.ts`). Sem as marcas, a folha é a de sempre.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { FolhaDoRoteiro, UnidadeDaFolha } from "@/servicos/folha-do-roteiro";

import { FolhaA4, QuadroDoCelular } from "./FolhaImpressa";

afterEach(cleanup);

function unidade(parcial: Partial<UnidadeDaFolha>): UnidadeDaFolha {
  return { tempo: null, rotulo: null, fala: null, falaMarcada: null, tom: null, mostrar: [], fimDoBloco: true, ...parcial };
}

function folha(comMarcas: boolean): FolhaDoRoteiro {
  return {
    marca: "Casa em Ordem",
    dataLonga: "segunda-feira, 7 de setembro de 2026",
    dataCurta: "7 de setembro",
    titulo: "O erro que faz a mancha voltar",
    chips: ["Reels", "40 segundos"],
    recado: null,
    unidades: [
      unidade({
        tempo: "0 a 3 s",
        rotulo: "Os 3 primeiros segundos",
        fala: "Se a mancha volta, o problema é a ordem.",
        falaMarcada: comMarcas ? "Se a mancha volta,{/} o problema é a {p:ordem}.{v}{//}" : null,
        tom: comMarcas ? "direto" : null,
      }),
      unidade({
        tempo: "3 a 12 s",
        rotulo: "O meio",
        fala: "Você já passou por isso?",
        falaMarcada: comMarcas ? "Você já {p:passou} por isso?{^}{//}" : null,
        tom: comMarcas ? "perto" : null,
      }),
    ],
    comMarcas,
    comoEditar: null,
    deOndeVeio: null,
    legenda: null,
    linhaDoPe: "Corte a cada 4 ou 5 s",
    nomeDoArquivo: "roteiro-2026-09-07",
  };
}

describe("a folha A4 com as marcas", () => {
  it("desenha a fala marcada, sem mudar o texto, e o tom ao lado do tempo", () => {
    const { container } = render(<FolhaA4 folha={folha(true)} />);
    const falas = Array.from(container.querySelectorAll("p")).map((p) => p.textContent);
    expect(falas).toContain("Se a mancha volta, o problema é a ordem.");
    expect(falas).toContain("Você já passou por isso?");
    expect(screen.getByText("tom: direto")).toBeTruthy();
    expect(screen.getByText("tom: perto")).toBeTruthy();
    expect(screen.getAllByRole("img", { name: "pausa longa" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: "tom sobe" })).toBeTruthy();
  });

  it("sem as marcas é a folha de sempre: texto simples, sem tom e sem marca desenhada", () => {
    const { container } = render(<FolhaA4 folha={folha(false)} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.textContent).not.toContain("tom:");
    expect(container.textContent).toContain("Se a mancha volta, o problema é a ordem.");
  });
});

describe("a imagem 9:16 com as marcas", () => {
  it("leva a legenda curta no pé do quadro, com as seis marcas, e o pé de sempre embaixo", () => {
    const { container } = render(<QuadroDoCelular folha={folha(true)} />);
    const pe = container.querySelector("[data-pe]")!;
    const legenda = pe.querySelector("[data-legenda-das-marcas]")!;
    expect(legenda).not.toBeNull();
    for (const palavra of ["peso", "pausa", "pausa longa", "devagar", "tom desce", "tom sobe"]) expect(legenda.textContent).toContain(palavra);
    // O texto e a página do pé continuam onde o paginador os procura.
    expect(pe.querySelector("[data-pe-texto]")?.textContent).toBe("Corte a cada 4 ou 5 s");
    expect(pe.querySelector("[data-pe-pagina]")).not.toBeNull();
    expect(screen.getByText("tom: direto")).toBeTruthy();
  });

  it("sem as marcas o pé não leva legenda", () => {
    const { container } = render(<QuadroDoCelular folha={folha(false)} />);
    expect(container.querySelector("[data-legenda-das-marcas]")).toBeNull();
    expect(container.querySelector("[data-pe-texto]")?.textContent).toBe("Corte a cada 4 ou 5 s");
  });
});
