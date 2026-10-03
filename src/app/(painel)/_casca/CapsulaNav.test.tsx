/**
 * A cápsula de navegação do celular (A2, itens 6 e 8): estando em Criar, o link Criar é o da página atual (aria-current) e o botão Mais não parece
 * selecionado; o Mais acende só nas rotas que a folha dele abre (agora também a Conta); a folha lista a entrada Conta e ajustes, que aponta para /conta.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let caminho = "/criar";
vi.mock("next/navigation", () => ({ usePathname: () => caminho, useRouter: () => ({ push: vi.fn() }) }));

import { CapsulaNav } from "./CapsulaNav";
import { FolhaMais } from "./FolhaMais";

beforeEach(() => {
  caminho = "/criar";
});

afterEach(cleanup);

function botaoMais(): HTMLElement {
  return screen.getByRole("button", { name: /Mais:/ });
}

describe("CapsulaNav", () => {
  it("em /criar o link Criar é a página atual e o botão Mais não tem a classe de ativo", () => {
    render(<CapsulaNav />);

    expect(screen.getByRole("link", { name: "Criar" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Hoje" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Planejar" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Criar" }).className).toMatch(/ativo/);
    expect(botaoMais().className).not.toMatch(/ativo/);
  });

  it("dentro de Criar (/criar/temas, /criar/tema-livre) a aba Criar continua acesa", () => {
    for (const rota of ["/criar/temas", "/criar/tema-livre", "/criar/objetivo"]) {
      caminho = rota;
      const { unmount } = render(<CapsulaNav />);
      expect(screen.getByRole("link", { name: "Criar" }).getAttribute("aria-current"), rota).toBe("page");
      expect(botaoMais().className, rota).not.toMatch(/ativo/);
      unmount();
    }
  });

  it("o Mais acende só nas rotas da folha dele (Referências, Notícias, Histórico e Conta), e nenhum link fica aceso nelas", () => {
    for (const rota of ["/referencias", "/noticias", "/historico", "/conta"]) {
      caminho = rota;
      const { unmount } = render(<CapsulaNav />);
      expect(botaoMais().className, rota).toMatch(/ativo/);
      for (const nome of ["Hoje", "Criar", "Planejar"]) expect(screen.getByRole("link", { name: nome }).getAttribute("aria-current"), `${rota} ${nome}`).toBeNull();
      unmount();
    }
  });

  it("em /hoje só Hoje acende; o Mais não", () => {
    caminho = "/hoje";
    render(<CapsulaNav />);

    expect(screen.getByRole("link", { name: "Hoje" }).getAttribute("aria-current")).toBe("page");
    expect(botaoMais().className).not.toMatch(/ativo/);
  });
});

describe("FolhaMais", () => {
  it("lista Conta e ajustes por último, com a linha curta, apontando para /conta", () => {
    render(<FolhaMais aoFechar={() => undefined} aoNavegar={(navegar) => navegar()} />);

    const links = screen.getAllByRole("link");
    const conta = links[links.length - 1];
    expect(conta.getAttribute("href")).toBe("/conta");
    expect(conta.textContent).toContain("Conta e ajustes");
    expect(conta.textContent).toContain("Ramo, perfis, lembrete, aviso de manhã, instalar");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/referencias", "/noticias", "/historico", "/conta"]);
  });

  it("tocar em Conta e ajustes navega pela folha (fechando pelo histórico)", () => {
    const aoNavegar = vi.fn();
    render(<FolhaMais aoFechar={() => undefined} aoNavegar={aoNavegar} />);

    fireEvent.click(screen.getByRole("link", { name: /Conta e ajustes/ }));

    expect(aoNavegar).toHaveBeenCalledTimes(1);
  });
});
