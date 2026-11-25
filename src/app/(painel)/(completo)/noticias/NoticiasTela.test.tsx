import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NoticiaNaTela } from "./CartaoDeNoticia";
import { NoticiasTela } from "./NoticiasTela";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => "/noticias", useSearchParams: () => new URLSearchParams() }));

afterEach(() => {
  cleanup();
  push.mockClear();
});

function noticia(n: number, extra: Partial<NoticiaNaTela> = {}): NoticiaNaTela {
  return {
    chave: `s-${n}`,
    tipo: "setor",
    noticiaId: n,
    assuntoId: null,
    origemRotulo: "Limpeza",
    titulo: `Manchete ${n}`,
    veiculo: "G1",
    quando: "há 3 h",
    resumo: null,
    url: "https://g1.globo.com/a",
    imagemUrl: null,
    imagemCredito: null,
    roteiroId: null,
    ...extra,
  };
}

const base = { dataPorExtenso: "quarta-feira, 25 de novembro", nomeDoSetor: "Limpeza", assuntos: [], emAlta: [], novasDesdeOntem: 3, falha: false, somenteLeitura: false };

describe("poucas notícias na janela", () => {
  it("com menos de 5, diz quantas achou e o botão amplia para a semana", () => {
    render(<NoticiasTela {...base} dias={3} deHoje={[noticia(1), noticia(2)]} deOntem={[noticia(3)]} />);
    expect(screen.getByText("Achamos só 3 notícias do seu ramo nos últimos 3 dias.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver a última semana" }));
    expect(push).toHaveBeenCalledWith("/noticias?ver=semana");
  });

  it("com 5 ou mais, nenhum aviso", () => {
    render(<NoticiasTela {...base} dias={3} deHoje={[1, 2, 3, 4, 5].map((n) => noticia(n))} deOntem={[]} />);
    expect(document.querySelector("[data-poucas-noticias]")).toBeNull();
  });

  it("já na semana, o aviso não oferece ampliar de novo", () => {
    render(<NoticiasTela {...base} dias={7} deHoje={[noticia(1)]} deOntem={[]} />);
    expect(screen.getByText("Achamos só 1 notícia do seu ramo nos últimos 7 dias.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ver a última semana" })).toBeNull();
  });

  it("o selo 'saiu agora' aparece só na notícia que o pede", () => {
    render(<NoticiasTela {...base} dias={3} deHoje={[noticia(1, { saiuAgora: true, quando: "há 40 min" }), noticia(2)]} deOntem={[]} />);
    expect(screen.getAllByText("saiu agora")).toHaveLength(1);
    expect(screen.getByText("há 40 min")).toBeTruthy();
  });
});
