/**
 * `CartaoDeData` (E60): as frases do Hoje ("Hoje é...", "Daqui a 7 dias é...", "Amanhã é..."), o corte de três linhas, o cartão da tela de temas com a fonte dita, o botão que leva
 * ao Tema livre com a data escrita, e o nada quando não há data.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const empurrar = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: empurrar }) }));

import type { DataMarcada, DataProxima } from "@/config/datas";

import { CartaoDeData, destinoDaData } from "./CartaoDeData";

afterEach(() => {
  cleanup();
  empurrar.mockClear();
});

const MAES: DataProxima = { chave: "dia-das-maes", nome: "Dia das Mães", tipo: "comercial", data: "2026-05-10", fonte: "Decreto 21.366/1932 (segundo domingo de maio)", dias: 7 };
const NATAL: DataMarcada = { chave: "natal", nome: "Natal", tipo: "feriado", data: "2026-12-25", fonte: "Lei 662/1949" };

describe("CartaoDeData", () => {
  it("não desenha nada sem data", () => {
    const { container } = render(<CartaoDeData hoje={[]} proximas={[]} variante="hoje" />);
    expect(container.innerHTML).toBe("");
  });

  it("no Hoje: 'Hoje é' para a de hoje e 'Daqui a 7 dias é' para a que vem, com o selo do tipo", () => {
    render(<CartaoDeData hoje={[NATAL]} proximas={[MAES]} variante="hoje" />);
    expect(screen.getByText("Hoje é Natal.")).not.toBeNull();
    expect(screen.getByText("Daqui a 7 dias é Dia das Mães.")).not.toBeNull();
    expect(screen.getByText("Feriado")).not.toBeNull();
    expect(screen.getByText("Data que vende")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Gravar sobre esta data" })).toHaveLength(2);
  });

  it("um dia antes, a frase é 'Amanhã é'", () => {
    render(<CartaoDeData hoje={[]} proximas={[{ ...MAES, dias: 1 }]} variante="hoje" />);
    expect(screen.getByText("Amanhã é Dia das Mães.")).not.toBeNull();
  });

  it("mostra no máximo três linhas, as de hoje primeiro", () => {
    const quatro: DataProxima[] = [2, 3, 4, 5].map((dias) => ({ ...MAES, chave: `d${dias}`, nome: `Data ${dias}`, dias }));
    render(<CartaoDeData hoje={[NATAL]} proximas={quatro} variante="hoje" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Hoje é Natal.")).not.toBeNull();
    expect(screen.queryByText("Daqui a 4 dias é Data 4.")).toBeNull();
  });

  it("na tela de temas: uma data só, a mais perto, dita como ponto de partida e com a fonte", () => {
    render(<CartaoDeData hoje={[]} proximas={[MAES, { ...MAES, chave: "outra", nome: "Outra", dias: 9 }]} variante="sugestao" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Uma data que vem aí")).not.toBeNull();
    expect(screen.getByText(/não de uma pesquisa de vídeos/)).not.toBeNull();
    expect(screen.getByText("Fonte da data: Decreto 21.366/1932 (segundo domingo de maio).")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Escrever sobre esta data" })).not.toBeNull();
  });

  it("o botão leva ao Tema livre com a data já escrita no campo", () => {
    render(<CartaoDeData hoje={[]} proximas={[MAES]} variante="hoje" />);
    fireEvent.click(screen.getByRole("button", { name: "Gravar sobre esta data" }));
    expect(empurrar).toHaveBeenCalledWith(destinoDaData(MAES));
    expect(destinoDaData(MAES)).toBe(`/criar/tema-livre?tema=${encodeURIComponent("Dia das Mães: o que eu posso gravar sobre essa data no meu negócio")}`);
  });
});
