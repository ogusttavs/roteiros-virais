// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { textosObjetivo } from "@/textos/objetivo";

import { ESPERA_MAXIMA_MIN, ESPERA_MAXIMA_MS, guardarDesfecho, guardarEspera, lerEspera, tomarDesfecho } from "./espera-guardada";

describe("espera guardada (E74 PR 1)", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("o prazo da espera guardada é o mesmo que a tela promete", () => {
    expect(textosObjetivo.esperaVersoesDuracao).toContain(String(ESPERA_MAXIMA_MIN));
    expect(ESPERA_MAXIMA_MS).toBe(ESPERA_MAXIMA_MIN * 60_000);
  });

  it("a espera vale até o prazo e é por tema", () => {
    guardarEspera("a", 1000);
    expect(lerEspera("a", 1000 + ESPERA_MAXIMA_MS)).toBe(1000);
    expect(lerEspera("a", 1001 + ESPERA_MAXIMA_MS)).toBeNull();
    expect(lerEspera("b", 1000)).toBeNull();
  });

  it("o desfecho (grupo ou erro) vale uma vez, só para o tema dele, e encerra a espera", () => {
    guardarEspera("a", Date.now());
    guardarDesfecho("a", { erro: "falhou" });
    expect(lerEspera("a")).toBeNull();
    expect(tomarDesfecho("b")).toBeNull();
    expect(tomarDesfecho("a")).toEqual({ erro: "falhou" });
    expect(tomarDesfecho("a")).toBeNull();
    guardarDesfecho("a", { grupo: "g1" });
    expect(tomarDesfecho("a")).toEqual({ grupo: "g1" });
  });

  it("desfecho velho ou ilegível não vale", () => {
    guardarDesfecho("a", { grupo: "g1" });
    expect(tomarDesfecho("a", Date.now() + ESPERA_MAXIMA_MS + 1000)).toBeNull();
    window.sessionStorage.setItem("objetivo-desfecho:a", "{nao json");
    expect(tomarDesfecho("a")).toBeNull();
  });
});
