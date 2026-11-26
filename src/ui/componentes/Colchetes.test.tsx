/**
 * O espaço para completar na fala (26/11/2026): o trecho entre colchetes é achado pela mesma regra do carrossel, destacado sem mudar uma letra do texto, e um pedaço solto da fala (a
 * fala marcada reparte o texto em vários) sabe se abre ou fecha o trecho.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { cortarNosColchetes, intervalosDeColchetes, TextoComColchetes } from "./Colchetes";

afterEach(cleanup);

describe("intervalosDeColchetes", () => {
  it("devolve o começo e o fim de cada trecho, na ordem", () => {
    const texto = "Ligue no [telefone da clínica] e venha às [horário].";
    expect(intervalosDeColchetes(texto)).toEqual([
      { inicio: 9, fim: 30 },
      { inicio: 42, fim: 51 },
    ]);
    expect(texto.slice(9, 30)).toBe("[telefone da clínica]");
    expect(texto.slice(42, 51)).toBe("[horário]");
  });

  it("colchete vazio, só com espaço ou quebrado em linhas não conta", () => {
    expect(intervalosDeColchetes("Nada [] aqui [  ] nem [isto\nquebrado].")).toEqual([]);
    expect(intervalosDeColchetes("Sem colchete nenhum.")).toEqual([]);
  });
});

describe("cortarNosColchetes", () => {
  const texto = "Ligue no [telefone da clínica] hoje.";
  const intervalos = intervalosDeColchetes(texto);

  it("o pedaço inteiro: fora, o trecho (que abre e fecha) e fora de novo", () => {
    expect(cortarNosColchetes(texto, 0, intervalos)).toEqual([
      { texto: "Ligue no ", colchete: false, abre: false, fecha: false },
      { texto: "[telefone da clínica]", colchete: true, abre: true, fecha: true },
      { texto: " hoje.", colchete: false, abre: false, fecha: false },
    ]);
  });

  it("um pedaço que começa no meio do trecho: a parte dele abre o trecho só se tiver o '['", () => {
    // "Ligue no [telefone " e "da clínica] hoje." (a fala marcada parte assim quando uma pausa cai depois de "telefone").
    expect(cortarNosColchetes("Ligue no [telefone ", 0, intervalos)).toEqual([
      { texto: "Ligue no ", colchete: false, abre: false, fecha: false },
      { texto: "[telefone ", colchete: true, abre: true, fecha: false },
    ]);
    expect(cortarNosColchetes("da clínica] hoje.", 19, intervalos)).toEqual([
      { texto: "da clínica]", colchete: true, abre: false, fecha: true },
      { texto: " hoje.", colchete: false, abre: false, fecha: false },
    ]);
  });

  it("um pedaço inteiro dentro do trecho não abre nem fecha", () => {
    expect(cortarNosColchetes("telefone da", 10, intervalos)).toEqual([{ texto: "telefone da", colchete: true, abre: false, fecha: false }]);
  });

  it("um pedaço fora de qualquer trecho fica inteiro, e o pedaço vazio não vira nada", () => {
    expect(cortarNosColchetes(" hoje.", 30, intervalos)).toEqual([{ texto: " hoje.", colchete: false, abre: false, fecha: false }]);
    expect(cortarNosColchetes("", 5, intervalos)).toEqual([]);
  });
});

describe("TextoComColchetes", () => {
  it("destaca só o trecho entre colchetes, e o texto continua letra por letra o mesmo", () => {
    render(
      <p data-testid="p">
        <TextoComColchetes texto="Ligue no [telefone da clínica] e venha às [horário]." />
      </p>,
    );
    const marcas = screen.getByTestId("p").querySelectorAll("mark[data-colchete]");
    expect([...marcas].map((m) => m.textContent)).toEqual(["[telefone da clínica]", "[horário]"]);
    expect(screen.getByTestId("p").textContent).toBe("Ligue no [telefone da clínica] e venha às [horário].");
  });

  it("sem colchete, é só o texto (nenhum destaque)", () => {
    render(
      <p data-testid="p">
        <TextoComColchetes texto="Um texto sem nada para completar, nem []." />
      </p>,
    );
    expect(screen.getByTestId("p").querySelector("mark")).toBeNull();
    expect(screen.getByTestId("p").textContent).toBe("Um texto sem nada para completar, nem [].");
  });
});
