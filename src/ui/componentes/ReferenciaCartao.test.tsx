/**
 * Hotfix de 22/10/2026: o cartão de Referências nunca fica num quadro vazio nem preto quando a capa do Instagram venceu. Sem capa viva ele escreve a rede e oferece "Ver no Instagram" (um link,
 * nunca um embed por cartão: dezenas de embeds pesariam no celular); com a capa guardada mostra a imagem da nossa rota.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReferenciaCartao, type VideoFormatado } from "./ReferenciaCartao";

const base: VideoFormatado = {
  id: 112308,
  url: "https://www.instagram.com/reel/DPqXyZ123ab/",
  plataforma: "instagram",
  multiplo: "6,2x",
  rotuloMultiplo: "acima do normal dessa conta",
  faixaMultiplo: "acima",
  views: 42900,
  medianaConta: 6900,
  velocidade: 890,
  contaNome: "Casa em Ordem",
  plataformaData: "Instagram, 1 de outubro",
  titulo: "a mancha que volta",
  assunto: "mancha",
  gancho: "g",
  estrutura: "e",
  porQueFuncionou: "p",
  capaUrl: null,
  semFala: false,
  segundoChave: null,
  abaixoDaRegua: false,
  tipoConteudo: null,
};

function montar(video: VideoFormatado) {
  return render(<ReferenciaCartao video={video} salvo={false} onVerDetalhes={vi.fn()} onSalvar={vi.fn()} />);
}

afterEach(cleanup);

describe("ReferenciaCartao, capa vencida", () => {
  it("Instagram sem capa: o nome da conta, a rede e o link 'Ver no Instagram' para o post", () => {
    const { container } = montar(base);
    expect(screen.getByText("Casa em Ordem")).toBeTruthy();
    expect(screen.getByText("Instagram, 1 de outubro")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Ver no Instagram" });
    expect(link.getAttribute("href")).toBe(base.url);
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("com a capa guardada: a imagem da nossa rota, sem o link de reserva", () => {
    const { container } = montar({ ...base, capaUrl: "/api/capa/112308" });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/capa/112308");
    expect(screen.queryByRole("link", { name: "Ver no Instagram" })).toBeNull();
  });

  it("a capa que falha ao carregar cai no mesmo quadro de reserva", () => {
    const { container } = montar({ ...base, capaUrl: "https://scontent-gru2-1.cdninstagram.com/v/vencida.jpg" });
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: "Ver no Instagram" })).toBeTruthy();
  });

  it("YouTube sem capa não ganha o link de reserva (a miniatura do YouTube não vence)", () => {
    montar({ ...base, plataforma: "youtube", url: "https://www.youtube.com/watch?v=abc" });
    expect(screen.queryByRole("link", { name: /Ver no/ })).toBeNull();
  });
});
