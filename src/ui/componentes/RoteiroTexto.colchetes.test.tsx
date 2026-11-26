/**
 * O espaço para completar na leitura do roteiro (26/11/2026): o trecho entre colchetes aparece destacado na fala, com as marcas de fala ligadas ou não, e na cena e no texto na tela do
 * Reels falado; o texto que a pessoa lê continua o do roteiro. `blocosComColchete` decide o aviso do alto e olha só o que a leitura destaca.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FalaMarcada } from "./FalaMarcada";
import { blocosComColchete, RoteiroTexto, type BlocoRoteiro } from "./RoteiroTexto";

afterEach(cleanup);

vi.mock("@/ui/useFolhaNoHistorico", () => ({ useFolhaNoHistorico: (_aberta: boolean, aoFechar: () => void) => ({ fechar: aoFechar }) }));

const marcasDe = (el: Element) => [...el.querySelectorAll("mark[data-colchete]")];

describe("FalaMarcada com os colchetes", () => {
  // A pausa cai no meio do trecho ("[telefone" fica na caixa da pausa) e o peso pega a última palavra dele ("clínica]").
  const MARCADO = "Ligue no [telefone{/} da {p:clínica]} hoje.{v}{//}";
  const ORIGINAL = "Ligue no [telefone da clínica] hoje.";

  function dentroDeParagrafo(comColchetes: boolean) {
    return render(
      <p data-testid="fala">
        <FalaMarcada marcado={MARCADO} comColchetes={comColchetes} />
      </p>,
    );
  }

  it("destaca o trecho inteiro, mesmo repartido entre a caixa da pausa, o texto solto e o peso, e o texto continua o mesmo", () => {
    dentroDeParagrafo(true);
    const fala = screen.getByTestId("fala");
    expect(marcasDe(fala).map((m) => m.textContent).join("")).toBe("[telefone da clínica]");
    expect(fala.textContent).toBe(ORIGINAL);
    // O peso continua sendo o <b>, agora com o destaque dentro.
    const peso = screen.getByText("clínica]", { selector: "b > mark" });
    expect(peso.parentElement?.tagName).toBe("B");
    // A pausa continua presa à palavra de antes.
    expect(screen.getByText("[telefone", { selector: "mark" }).parentElement?.querySelector('[aria-label="pausa curta"]')).not.toBeNull();
    // O que está fora do trecho não ganha destaque.
    expect(marcasDe(fala).some((m) => m.textContent?.includes("Ligue") || m.textContent?.includes("hoje"))).toBe(false);
  });

  it("sem pedir (o PDF), nada é destacado", () => {
    dentroDeParagrafo(false);
    expect(screen.getByTestId("fala").querySelector("mark")).toBeNull();
    expect(screen.getByTestId("fala").textContent).toBe(ORIGINAL);
  });

  it("dois trechos no mesmo parágrafo, com marcas entre eles: cada um com o seu destaque", () => {
    render(
      <p data-testid="fala">
        <FalaMarcada marcado="Venha às [horário],{/} na {p:[rua]}.{v}{//}" comColchetes />
      </p>,
    );
    const fala = screen.getByTestId("fala");
    expect(marcasDe(fala).map((m) => m.textContent)).toEqual(["[horário]", "[rua]"]);
    expect(fala.textContent).toBe("Venha às [horário], na [rua].");
  });
});

describe("RoteiroTexto com os colchetes", () => {
  const blocos: BlocoRoteiro[] = [
    { rotulo: "Os 3 primeiros segundos", paragrafos: ["Ligue no [telefone da clínica] hoje."] },
    {
      rotulo: "O meio",
      paragrafos: ["Sem nada para completar."],
      mostrar: ["Atendemos em [bairro]"],
      cenas: [{ momento: "Na [sala de espera]", oQueFazer: "Mostre o [produto] na mão" }],
    },
  ];

  it("destaca o trecho na fala, sem mudar o texto", () => {
    const { container } = render(<RoteiroTexto blocos={blocos} />);
    const fala = [...container.querySelectorAll("p")].find((p) => p.textContent === "Ligue no [telefone da clínica] hoje.");
    expect(fala).toBeTruthy();
    expect(marcasDe(fala!).map((m) => m.textContent)).toEqual(["[telefone da clínica]"]);
  });

  it("com as marcas de fala ligadas, o destaque continua", () => {
    const marcados: BlocoRoteiro[] = [{ ...blocos[0], marcado: ["Ligue no {p:[telefone da clínica]} hoje.{v}{//}"], tom: "direto" }];
    const { container } = render(<RoteiroTexto blocos={marcados} comMarcas />);
    expect(screen.getAllByRole("img", { name: "pausa longa" }).length).toBeGreaterThan(0);
    expect(marcasDe(container).map((m) => m.textContent)).toEqual(["[telefone da clínica]"]);
  });

  it("no Reels falado, a cena e o texto na tela também ficam destacados", () => {
    const { container } = render(<RoteiroTexto blocos={blocos} comCenas />);
    const cena = container.querySelector("[data-cena-do-bloco]") as HTMLElement;
    expect(marcasDe(cena).map((m) => m.textContent)).toEqual(["[sala de espera]", "[produto]", "[bairro]"]);
    expect(cena.textContent).toContain("Na [sala de espera] Mostre o [produto] na mão");
  });

  it("um roteiro sem colchete não ganha destaque nenhum", () => {
    const { container } = render(<RoteiroTexto blocos={[{ rotulo: "O meio", paragrafos: ["Primeiro aplica [], depois espera."] }]} comCenas />);
    expect(container.querySelector("mark")).toBeNull();
  });
});

describe("blocosComColchete", () => {
  it("acha o colchete na fala, com ou sem as cenas", () => {
    expect(blocosComColchete([{ paragrafos: ["Ligue no [telefone]."] }], false)).toBe(true);
    expect(blocosComColchete([{ paragrafos: ["Ligue no [telefone]."] }], true)).toBe(true);
  });

  it("o texto na tela e a cena só contam quando a leitura os mostra (Reels falado)", () => {
    const soNaCena = [{ paragrafos: ["Sem nada."], mostrar: ["Atendemos em [bairro]"] }];
    expect(blocosComColchete(soNaCena, true)).toBe(true);
    expect(blocosComColchete(soNaCena, false)).toBe(false);
    const soNoMomento = [{ paragrafos: ["Sem nada."], cenas: [{ momento: "Na [sala]", oQueFazer: "Mostre a porta" }] }];
    expect(blocosComColchete(soNoMomento, true)).toBe(true);
    const soNoQueFazer = [{ paragrafos: ["Sem nada."], cenas: [{ momento: "Na sala", oQueFazer: "Mostre o [produto]" }] }];
    expect(blocosComColchete(soNoQueFazer, true)).toBe(true);
    expect(blocosComColchete(soNoQueFazer, false)).toBe(false);
  });

  it("sem colchete (ou com colchete vazio), não há o que completar", () => {
    expect(blocosComColchete([{ paragrafos: ["Primeiro aplica, depois espera."] }, { paragrafos: ["Nada [] aqui."], mostrar: ["Sem nada"] }], true)).toBe(false);
    expect(blocosComColchete([], true)).toBe(false);
  });
});
