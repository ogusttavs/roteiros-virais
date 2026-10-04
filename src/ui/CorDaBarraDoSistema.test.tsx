/**
 * A cor da faixa de cima do sistema (achado do Gustavo no iPhone instalado, 04/10): a meta `theme-color` é a cor de verdade do cabeçalho sobre o fundo, em cada tema,
 * e muda junto quando o `data-tema` do `<html>` muda. O iPhone em si só se prova no aparelho; aqui o que o código decide.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/hoje" }));

import { CorDaBarraDoSistema, misturarCores } from "./CorDaBarraDoSistema";

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("data-tema");
});

function metaAtual(): string[] {
  return Array.from(document.head.querySelectorAll('meta[name="theme-color"]')).map((m) => m.getAttribute("content") ?? "");
}

describe("misturarCores", () => {
  it("o vidro escuro do cabeçalho sobre o fundo escuro dá o cinza que o olho vê", () => {
    expect(misturarCores("rgba(28, 28, 32, 0.82)", "rgb(5, 5, 6)")).toBe("#18181b");
  });

  it("o vidro claro sobre o fundo claro, e uma cor opaca fica como está", () => {
    expect(misturarCores("rgba(252, 252, 250, 0.8)", "rgb(247, 247, 245)")).toBe("#fbfbf9");
    expect(misturarCores("rgb(10, 20, 30)", "rgb(255, 255, 255)")).toBe("#0a141e");
  });

  it("uma cor que não se sabe ler devolve nulo", () => {
    expect(misturarCores("transparent", "rgb(0, 0, 0)")).toBeNull();
  });
});

describe("CorDaBarraDoSistema", () => {
  it("com cabeçalho fixo, põe a cor do cabeçalho sobre o fundo nas metas do servidor, sem remover nenhuma (o React as gerencia) e tirando o media", () => {
    document.body.style.background = "rgb(5, 5, 6)";
    document.body.innerHTML = '<header data-barra-topo="" style="background: rgba(28, 28, 32, 0.82)"></header>';
    for (const media of ["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"]) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.content = "#f7f7f5";
      meta.setAttribute("media", media);
      document.head.appendChild(meta);
    }

    render(<CorDaBarraDoSistema />);

    expect(metaAtual()).toEqual(["#18181b", "#18181b"]);
    expect(document.head.querySelectorAll('meta[name="theme-color"][media]')).toHaveLength(0);
  });

  it("sem cabeçalho fixo (o modo gravação, o Começar, o Entrar), a cor é a do fundo da tela", () => {
    document.body.style.background = "rgb(5, 5, 6)";

    render(<CorDaBarraDoSistema />);

    expect(metaAtual()).toEqual(["#050506"]);
  });

  it("quando o tema da Conta muda (o data-tema do html), a meta muda junto", async () => {
    document.body.style.background = "rgb(5, 5, 6)";
    document.body.innerHTML = '<header data-barra-topo="" style="background: rgba(28, 28, 32, 0.82)"></header>';
    render(<CorDaBarraDoSistema />);
    expect(metaAtual()).toEqual(["#18181b"]);

    // O tema claro: o corpo e o cabeçalho mudam de cor (no app, é o CSS que troca) e o atributo avisa.
    document.body.style.background = "rgb(247, 247, 245)";
    (document.querySelector("[data-barra-topo]") as HTMLElement).style.background = "rgba(252, 252, 250, 0.8)";
    document.documentElement.setAttribute("data-tema", "claro");

    await waitFor(() => expect(metaAtual()).toEqual(["#fbfbf9"]));
  });
});
