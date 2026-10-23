/**
 * O cartão de tema (hotfix de 23/10/2026): o tema que nasceu de uma notícia diz de onde veio no lugar do bloco do vídeo, e nunca mostra número de visualização.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { textosHoje } from "@/textos/hoje";

import { TemaCartao, type EvidenciaTema } from "./TemaCartao";

afterEach(cleanup);

const VIDEO: EvidenciaTema = { conta: "@conta", multiplo: "4,1x", rotulo: "acima do normal dessa conta", views: "120 mil", quando: "ontem", parecidos: 2 };
const BASE = { rotulo: "para te chamarem", tema: "Um tema", porque: "Porque sim", rotuloBotao: "Quero esse", onEscolher: () => undefined };

describe("TemaCartao, tema que nasceu de uma notícia", () => {
  it("mostra a notícia (título, veículo e quando) e nenhuma conta nem número de visualização", () => {
    const { container } = render(<TemaCartao {...BASE} evidencia={null} fonteNoticia={{ titulo: "Seminários gratuitos abordam branding", veiculo: "Veículo de teste", quando: "ontem" }} />);
    expect(screen.getByText(textosHoje.temaDeNoticia.rotulo)).toBeTruthy();
    expect(screen.getByText("Seminários gratuitos abordam branding")).toBeTruthy();
    expect(screen.getByText("Veículo de teste, ontem")).toBeTruthy();
    expect(container.querySelector("[data-fonte-noticia]")).not.toBeNull();
    expect(container.textContent).not.toContain("visualiza");
  });

  it("sem veículo, só o quando", () => {
    render(<TemaCartao {...BASE} evidencia={null} fonteNoticia={{ titulo: "Título", veiculo: null, quando: "hoje" }} />);
    expect(screen.getByText("hoje")).toBeTruthy();
  });

  it("com vídeo de prova, o bloco do vídeo vence e a notícia não aparece", () => {
    const { container } = render(<TemaCartao {...BASE} evidencia={VIDEO} fonteNoticia={{ titulo: "Título", veiculo: null, quando: "hoje" }} />);
    expect(screen.getByText("@conta")).toBeTruthy();
    expect(container.querySelector("[data-fonte-noticia]")).toBeNull();
  });

  it("sem vídeo e sem notícia, nenhum bloco de fonte", () => {
    const { container } = render(<TemaCartao {...BASE} evidencia={null} />);
    expect(container.querySelector("[data-fonte-noticia]")).toBeNull();
  });
});

describe("textosHoje, tema de notícia e poucos temas", () => {
  it("o quando fala em português de gente", () => {
    expect(textosHoje.temaDeNoticia.quando(0)).toBe("hoje");
    expect(textosHoje.temaDeNoticia.quando(1)).toBe("ontem");
    expect(textosHoje.temaDeNoticia.quando(3)).toBe("há 3 dias");
  });

  it("a frase calma de menos de três temas não promete nem culpa", () => {
    expect(textosHoje.poucosTemas(1)).toContain("só um tema");
    expect(textosHoje.poucosTemas(2)).toContain("só dois temas");
    expect(textosHoje.poucosTemas(2)).toContain("Preferimos mostrar menos a inventar um tema sem base");
  });
});
