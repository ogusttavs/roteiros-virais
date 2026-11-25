import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SlideDoCarrossel } from "@/config/carrossel";

import { CarrosselTela } from "./CarrosselTela";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

const slides = (texto: string): SlideDoCarrossel[] => [
  { tipo: "capa-texto", titulo: "2 erros com o fio dental" },
  { tipo: "item", titulo: "Um item", texto },
  { tipo: "chamada", titulo: "Quer?", texto: "Salve", acoes: ["a", "b"] },
];
const dados = (texto: string, legenda: string) => ({
  carrossel: { id: 9, tema: "fio dental", quantidade: 3, cor: "#0e5a6a", avisos: [], slides: slides(texto), legenda, hashtags: ["#dentista"] },
  fotos: [],
  fotosDosSlides: [{ foto: null, fotoDepois: null }, { foto: null, fotoDepois: null }, { foto: null, fotoDepois: null }],
  slidesComFoto: [false, false, false],
});
const previa = { slides: [1, 2, 3].map((n) => ({ n, imagem: "data:image/png;base64,AAAA", precisaEncurtar: false, semFoto: false })) };

function abrir(texto: string, legenda: string) {
  vi.mocked(fetch).mockImplementation(async (url) => (String(url).endsWith("/previa") ? json(previa) : json(dados(texto, legenda))));
  render(<CarrosselTela temasDeHoje={[]} corMarca="#0e5a6a" arroba="@clinica.exemplo" ramoSaude idInicial={9} />);
}

const escrever = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  escrever.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("o espaço para completar (trecho entre colchetes)", () => {
  it("avisa nos slides e na legenda, destaca o trecho e marca o slide", async () => {
    abrir("Agende pelo [telefone da clínica] hoje mesmo", "Confira [os horários de atendimento] e venha.");
    expect(await screen.findByTestId("aviso-colchetes")).toBeTruthy();
    expect(screen.getByTestId("aviso-colchetes").textContent).toMatch(/O slide 2 tem um trecho entre colchetes/);
    expect(screen.getByTestId("colchetes-da-legenda").textContent).toMatch(/Complete o que está entre colchetes antes de postar/);
    const destaque = screen.getByTestId("colchetes-da-legenda").parentElement!.querySelector("mark");
    expect(destaque?.textContent).toBe("[os horários de atendimento]");
    expect(screen.getByText("Completar")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Slide 2 de 3/ }));
    expect((await screen.findByTestId("colchetes-do-slide")).textContent).toContain("[telefone da clínica]");
  });

  it("copiar a legenda com colchete pergunta antes; 'Voltar e completar' não copia, 'Copiar assim mesmo' copia", async () => {
    abrir("Texto limpo de colchete com mais de oito palavras aqui", "Confira [os horários de atendimento] e venha.");
    fireEvent.click(await screen.findByRole("button", { name: "Copiar a legenda" }));
    const caixa = await screen.findByTestId("confirma-copiar");
    expect(caixa.textContent).toContain("Ainda tem espaço para completar. Copiar assim mesmo?");
    expect(escrever).not.toHaveBeenCalled();
    fireEvent.click(within(caixa).getByRole("button", { name: "Voltar e completar" }));
    expect(screen.queryByTestId("confirma-copiar")).toBeNull();
    expect(escrever).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copiar a legenda" }));
    fireEvent.click(within(await screen.findByTestId("confirma-copiar")).getByRole("button", { name: "Copiar assim mesmo" }));
    await waitFor(() => expect(escrever).toHaveBeenCalledTimes(1));
  });

  it("baixar com colchete nos slides pergunta antes de buscar o zip", async () => {
    abrir("Agende pelo [telefone da clínica] hoje mesmo", "Legenda limpa.");
    fireEvent.click(await screen.findByRole("button", { name: /Baixar as 3 imagens/ }));
    const caixa = await screen.findByTestId("confirma-baixar");
    expect(caixa.textContent).toContain("Baixar assim mesmo?");
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith("/zip"))).toBe(false);
  });

  it("sem colchete, nada de aviso e copiar vai direto", async () => {
    abrir("Texto limpo de colchete com mais de oito palavras aqui", "Legenda limpa.");
    fireEvent.click(await screen.findByRole("button", { name: "Copiar a legenda" }));
    await waitFor(() => expect(escrever).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("aviso-colchetes")).toBeNull();
    expect(screen.queryByTestId("colchetes-da-legenda")).toBeNull();
    expect(screen.queryByTestId("confirma-copiar")).toBeNull();
  });
});
