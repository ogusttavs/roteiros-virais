/**
 * O modo gravação com o espaço para completar (26/11/2026): o trecho entre colchetes fica destacado na letra grande, no "o que mostrar" e na frase do bloco seguinte, com as marcas de fala
 * ligadas ou não, sem mudar o texto que a pessoa lê.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FalaDoRoteiro } from "@/lib/marcas-de-fala";

const { marcarGravadoAction, marcarFalaAction, push } = vi.hoisted(() => ({ marcarGravadoAction: vi.fn(), marcarFalaAction: vi.fn(), push: vi.fn() }));
vi.mock("@/app/(painel)/(completo)/roteiros/[id]/acoes", () => ({ marcarGravadoAction, marcarFalaAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/ui/useSemRede", () => ({ useSemRede: () => false }));
vi.mock("@/ui/useFolhaNoHistorico", () => ({ useFolhaNoHistorico: (_aberta: boolean, aoFechar: () => void) => ({ fechar: aoFechar }) }));

import { GravacaoTela } from "./GravacaoTela";

const BLOCOS = [
  { rotulo: "Os 3 primeiros segundos", paragrafos: ["Ligue no [telefone da clínica] hoje."], mostrar: ["Atendemos em [bairro]"] },
  { rotulo: "O meio", paragrafos: ["Venha às [horário] e traga a receita."] },
  { rotulo: "O fechamento", paragrafos: ["Sem nada para completar."] },
  { rotulo: "A chamada final", paragrafos: ["Chame no WhatsApp."] },
];

const SEM_MARCAS: FalaDoRoteiro = { podeMarcar: false, somenteLeitura: false, marcas: null };
const COM_MARCAS: FalaDoRoteiro = {
  podeMarcar: true,
  somenteLeitura: false,
  marcas: {
    blocos: [
      { bloco: "gancho", marcado: "Ligue no [telefone{/} da {p:clínica]} hoje.{v}{//}", tom: "direto" },
      { bloco: "corpo", marcado: "Venha às [horário] e traga a receita.{//}", tom: "calmo" },
      { bloco: "fechamento", marcado: "Sem nada para completar.{//}", tom: "perto" },
      { bloco: "chamadaFinal", marcado: "Chame no {p:WhatsApp}.{v}", tom: "firme" },
    ],
    avisos: [],
  },
};

function montar(fala: FalaDoRoteiro) {
  return render(<GravacaoTela roteiroId={42} titulo="O telefone" blocos={BLOCOS} jaGravado={false} fala={fala} marcaId={7} />);
}

const palco = () => document.querySelector("main") as HTMLElement;
const marcasDe = (el: Element) => [...el.querySelectorAll("mark[data-colchete]")].map((m) => m.textContent);

beforeEach(() => {
  window.localStorage.clear();
  marcarGravadoAction.mockReset().mockResolvedValue(undefined);
  marcarFalaAction.mockReset();
  push.mockReset();
});
afterEach(cleanup);

describe("GravacaoTela com os colchetes", () => {
  it("sem as marcas: destaca o trecho na fala, no que mostrar e na frase do bloco seguinte", async () => {
    montar(SEM_MARCAS);
    await waitFor(() => expect(palco().textContent).toContain("Ligue no [telefone da clínica] hoje."));
    expect(marcasDe(palco())).toEqual(["[telefone da clínica]", "[bairro]", "[horário]"]);
    const fala = [...palco().querySelectorAll("p")].find((p) => p.textContent === "Ligue no [telefone da clínica] hoje.");
    expect(fala).toBeTruthy();
  });

  it("com as marcas ligadas: o destaque continua inteiro, e o texto lido é o do roteiro", async () => {
    montar(COM_MARCAS);
    await waitFor(() => expect(palco().querySelector('[aria-label="pausa curta"]')).not.toBeNull());
    const fala = [...palco().querySelectorAll("p")].find((p) => p.textContent === "Ligue no [telefone da clínica] hoje.");
    expect(fala).toBeTruthy();
    expect(marcasDe(fala!).join("")).toBe("[telefone da clínica]");
    expect(marcarFalaAction).not.toHaveBeenCalled();
  });

  it("um bloco sem colchete não ganha destaque", async () => {
    render(<GravacaoTela roteiroId={42} titulo="Sem nada" blocos={[BLOCOS[2], BLOCOS[3]]} jaGravado={false} fala={SEM_MARCAS} marcaId={7} />);
    await waitFor(() => expect(palco().textContent).toContain("Sem nada para completar."));
    expect(palco().querySelector("mark")).toBeNull();
  });
});
