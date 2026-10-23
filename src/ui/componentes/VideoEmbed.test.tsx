/**
 * Hotfix de 22/10/2026, a capa vencida do Instagram: o link assinado do CDN da Meta dava 403 e a Referência virava um quadro preto só com o play. Na tela de um vídeo, sem capa viva (vencida
 * de saída, ou que falha ao carregar) o Instagram monta o embed oficial na hora; com capa que abre, nada muda (a capa com o play); o que não é Instagram cai num quadro neutro, nunca preto.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { VideoEmbed } from "./VideoEmbed";

const REEL = "https://www.instagram.com/reel/DPqXyZ123ab/";

function montar(url: string, capaUrl: string | null) {
  return render(<VideoEmbed url={url} alt="vídeo de Casa em Ordem" rotuloCarregamento="Carregando o vídeo" hrefExterno={url} capaUrl={capaUrl} />);
}

afterEach(cleanup);

describe("VideoEmbed, capa do Instagram", () => {
  it("capa viva: a capa com o play, e nenhum embed montado ainda", () => {
    const { container } = montar(REEL, "/api/capa/112308");
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/capa/112308");
    expect(screen.getByRole("button", { name: /vídeo de Casa em Ordem/ })).toBeTruthy();
  });

  it("sem capa (vencida e não guardada): o embed oficial entra na hora, sem o quadro preto com o play", () => {
    const { container } = montar(REEL, null);
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe("https://www.instagram.com/reel/DPqXyZ123ab/embed");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a capa que falha ao carregar (403 do CDN) troca pelo embed na hora", () => {
    const { container } = montar(REEL, "https://scontent-gru2-1.cdninstagram.com/v/t51/vencida.jpg");
    expect(container.querySelector("iframe")).toBeNull();
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe("https://www.instagram.com/reel/DPqXyZ123ab/embed");
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("VideoEmbed, o que não é Instagram", () => {
  it("YouTube sem capa: quadro neutro com o play (a classe do quadro claro), com a rede escrita", () => {
    const { container } = montar("https://www.youtube.com/watch?v=abc123", null);
    const botao = screen.getByRole("button", { name: /vídeo de Casa em Ordem/ });
    expect(botao.className).toMatch(/capaJogarSemCapa/);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("YouTube")).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("TikTok sem capa também cai no quadro neutro, e com capa viva mantém a capa e o véu", () => {
    const { container, rerender } = montar("https://www.tiktok.com/@casa/video/7401", null);
    expect(screen.getByRole("button").className).toMatch(/capaJogarSemCapa/);
    rerender(<VideoEmbed url="https://www.tiktok.com/@casa/video/7401" alt="vídeo de Casa em Ordem" rotuloCarregamento="Carregando o vídeo" hrefExterno="https://www.tiktok.com/@casa/video/7401" capaUrl="/api/capa/9" />);
    expect(screen.getByRole("button").className).not.toMatch(/capaJogarSemCapa/);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/capa/9");
  });
});
