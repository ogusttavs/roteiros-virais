import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CapaTela } from "./CapaTela";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const NOTICIA = { id: 7, titulo: "Conselho publica regra nova", veiculo: "Jornal da Cidade", data: "24/11/2026" };
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const escrever = vi.fn().mockResolvedValue(undefined);

function abrirCom(titulo: string, legenda: string) {
  const dados = {
    carrossel: { id: 55, tema: NOTICIA.titulo, quantidade: 1, cor: "#0e5a6a", avisos: [], slides: [{ tipo: "noticia", titulo, veiculo: NOTICIA.veiculo, data: NOTICIA.data }], legenda, hashtags: [] },
    fotos: [],
    fotosDosSlides: [{ foto: null, fotoDepois: null }],
    slidesComFoto: [false],
  };
  vi.mocked(fetch).mockImplementation(async (url) => (String(url).endsWith("/previa") ? json({ slides: [{ n: 1, imagem: "data:image/png;base64,AAAA", precisaEncurtar: false, semFoto: true }] }) : json(dados)));
  render(<CapaTela noticia={NOTICIA} corMarca="#0e5a6a" arroba="" capaInicialId={55} />);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  escrever.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("o espaço para completar na capa de notícia", () => {
  it("com colchete na legenda, avisa, destaca e pergunta antes de copiar", async () => {
    abrirCom("O que muda no seu clareamento", "Fale com a gente: [telefone da clínica].");
    expect((await screen.findByTestId("colchetes-da-legenda")).textContent).toContain("Complete o que está entre colchetes antes de postar");
    fireEvent.click(screen.getByRole("button", { name: "Copiar a legenda" }));
    expect((await screen.findByTestId("confirma-copiar")).textContent).toContain("Copiar assim mesmo?");
    expect(escrever).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copiar assim mesmo" }));
    await waitFor(() => expect(escrever).toHaveBeenCalledTimes(1));
  });

  it("com colchete na imagem, baixar pergunta antes de buscar o arquivo", async () => {
    abrirCom("Ligue para [telefone da clínica]", "Legenda limpa.");
    expect((await screen.findByTestId("aviso-colchetes")).textContent).toContain("[telefone da clínica]");
    fireEvent.click(screen.getByRole("button", { name: "Baixar a imagem" }));
    expect((await screen.findByTestId("confirma-baixar")).textContent).toContain("Baixar assim mesmo?");
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith("/slide/1"))).toBe(false);
  });

  it("sem colchete, copiar vai direto", async () => {
    abrirCom("O que muda no seu clareamento", "Legenda limpa.");
    fireEvent.click(await screen.findByRole("button", { name: "Copiar a legenda" }));
    await waitFor(() => expect(escrever).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("confirma-copiar")).toBeNull();
  });
});
