/**
 * A2, item 9: a folha "Informações do aparelho" só aparece para quem tem sessão de admin; o cliente comum não a vê, e o texto dela não cita nome de agente.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(painel)/_casca/useTeclado", () => ({ useTecladoAberto: () => false }));

// O jsdom não tem `matchMedia` (a folha pergunta se o aplicativo está instalado).
beforeEach(() => {
  window.matchMedia = ((consulta: string) => ({ matches: false, media: consulta, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
});

import { textosConta } from "@/textos/conta";

import { InformacoesDoAparelhoAdmin } from "./InformacoesDoAparelhoAdmin";

afterEach(cleanup);

describe("InformacoesDoAparelhoAdmin", () => {
  it("o cliente comum não vê nada (nem o botão que abre a folha)", () => {
    render(<InformacoesDoAparelhoAdmin ehAdmin={false} versaoPainel="abc1234" />);

    expect(screen.queryByRole("button", { name: /Informações do aparelho/ })).toBeNull();
    expect(screen.queryByText(/Informações do aparelho/)).toBeNull();
  });

  it("o admin vê o botão, e a folha abre com a frase sem nome de agente", () => {
    render(<InformacoesDoAparelhoAdmin ehAdmin versaoPainel="abc1234" />);

    fireEvent.click(screen.getByRole("button", { name: /Informações do aparelho/ }));

    expect(screen.getByRole("dialog", { name: "Informações do aparelho" })).toBeTruthy();
    expect(screen.getByText("Informações do aparelho, para a gente entender o que apareceu torto. Nada daqui sai do seu navegador.")).toBeTruthy();
    expect(screen.queryByText(/Fable/)).toBeNull();
    expect(textosConta.diagnostico.explica).not.toMatch(/Fable/);
  });
});
