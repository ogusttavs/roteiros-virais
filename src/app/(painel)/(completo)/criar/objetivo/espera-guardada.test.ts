// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { textosObjetivo } from "@/textos/objetivo";

import {
  ESPERA_COM_PEDIDO_MS,
  ESPERA_MAXIMA_MIN,
  ESPERA_MAXIMA_MS,
  GRACA_DO_PEDIDO_MS,
  guardarDesfecho,
  guardarEspera,
  haEsperaGuardada,
  haEsperaSemResposta,
  lerEspera,
  limparEsperaDoPedido,
  pedidosDasEsperas,
  tomarDesfecho,
} from "./espera-guardada";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

describe("espera guardada (E74 PR 1)", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("o prazo da espera guardada é o mesmo que a tela promete", () => {
    expect(textosObjetivo.esperaVersoesDuracao).toContain(String(ESPERA_MAXIMA_MIN));
    expect(ESPERA_MAXIMA_MS).toBe(ESPERA_MAXIMA_MIN * 60_000);
  });

  it("a espera sem pedido vale até o prazo e é por tema", () => {
    guardarEspera("a", { desde: 1000, pedidoId: null });
    expect(lerEspera("a", 1000 + ESPERA_MAXIMA_MS)).toEqual({ desde: 1000, pedidoId: null });
    expect(lerEspera("a", 1001 + ESPERA_MAXIMA_MS)).toBeNull();
    expect(lerEspera("b", 1000)).toBeNull();
  });

  it("o desfecho (grupo ou erro) vale uma vez, só para o tema dele, e encerra a espera", () => {
    guardarEspera("a", { desde: Date.now(), pedidoId: P1 });
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

describe("espera guardada com o id do pedido (E74 PR 2a, R-c)", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("guarda o id do pedido e vale mais que a do PR 1 (quem diz se acabou é o servidor)", () => {
    expect(ESPERA_COM_PEDIDO_MS).toBeGreaterThan(ESPERA_MAXIMA_MS);
    guardarEspera("a", { desde: 1000, pedidoId: P1 });
    expect(lerEspera("a", 1000 + ESPERA_MAXIMA_MS + 1)).toEqual({ desde: 1000, pedidoId: P1 });
    expect(lerEspera("a", 1000 + ESPERA_COM_PEDIDO_MS)).toEqual({ desde: 1000, pedidoId: P1 });
    expect(lerEspera("a", 1001 + ESPERA_COM_PEDIDO_MS)).toBeNull();
  });

  it("lê a espera do PR 1 (só o número), de uma aba aberta antes da subida", () => {
    window.sessionStorage.setItem("objetivo-escrevendo:a", "1000");
    expect(lerEspera("a", 2000)).toEqual({ desde: 1000, pedidoId: null });
    window.sessionStorage.setItem("objetivo-escrevendo:b", "{nao json");
    expect(lerEspera("b", 2000)).toBeNull();
    window.sessionStorage.setItem("objetivo-escrevendo:c", JSON.stringify({ desde: "x", pedidoId: P1 }));
    expect(lerEspera("c", 2000)).toBeNull();
  });

  it("os pedidos das esperas desta aba, e apagar a de um pedido não apaga a de outro (R-b)", () => {
    const agora = Date.now();
    guardarEspera("a", { desde: agora, pedidoId: P1 });
    guardarEspera("b", { desde: agora, pedidoId: P2 });
    guardarEspera("c", { desde: agora, pedidoId: null });
    expect(new Set(pedidosDasEsperas(agora))).toEqual(new Set([P1, P2]));
    limparEsperaDoPedido(P1);
    expect(lerEspera("a", agora)).toBeNull();
    expect(lerEspera("b", agora)).toEqual({ desde: agora, pedidoId: P2 });
    expect(lerEspera("c", agora)).toEqual({ desde: agora, pedidoId: null });
    expect(haEsperaGuardada(agora)).toBe(true);
  });

  it("depois de o servidor responder: a espera com id vale enquanto ele diz que anda, ou enquanto o pedido ainda pode estar chegando", () => {
    guardarEspera("a", { desde: 1000, pedidoId: P1 });
    expect(haEsperaSemResposta(new Set(), 1000 + GRACA_DO_PEDIDO_MS - 1)).toBe(true);
    // passada a graça, um id que o servidor não conhece nunca chegou: o "Escrevendo" não fica pendurado nele
    expect(haEsperaSemResposta(new Set(), 1000 + GRACA_DO_PEDIDO_MS)).toBe(false);
    expect(haEsperaSemResposta(new Set([P1]), 1000 + GRACA_DO_PEDIDO_MS)).toBe(true);
    // a do PR 1 (sem id) vale pelo prazo dela
    window.sessionStorage.clear();
    guardarEspera("b", { desde: 1000, pedidoId: null });
    expect(haEsperaSemResposta(new Set(), 1000 + GRACA_DO_PEDIDO_MS)).toBe(true);
  });
});
