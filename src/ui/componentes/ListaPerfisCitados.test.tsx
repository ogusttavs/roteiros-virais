import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListaPerfisCitados } from "./ListaPerfisCitados";

afterEach(() => {
  cleanup();
});

const PROPS_BASE = {
  titulo: "Concorrentes",
  textoAdicionar: "Adicionar outro:",
  textoTirar: (endereco: string) => `Tirar ${endereco}`,
  avisoInvalido: "Confira o nome do perfil",
  limite: 10,
};

describe("ListaPerfisCitados (V12c, item 7, a E37b)", () => {
  it("mostra cada item salvo como endereço fixo, com o x para tirar", () => {
    render(
      <ListaPerfisCitados
        {...PROPS_BASE}
        itens={[{ id: 1, rede: "instagram", handle: "limpatudoexpress" }]}
        onAdicionar={vi.fn()}
        onRemover={vi.fn()}
      />,
    );
    expect(screen.getByText("instagram.com/limpatudoexpress")).toBeTruthy();
  });

  it("clicar na rede abre um campo; sair do campo com texto chama onAdicionar", async () => {
    const onAdicionar = vi.fn().mockResolvedValue(undefined);
    render(<ListaPerfisCitados {...PROPS_BASE} itens={[]} onAdicionar={onAdicionar} onRemover={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "TikTok" }));
    const campo = await screen.findByLabelText("Perfil no TikTok");
    fireEvent.change(campo, { target: { value: "oficinaderro" } });
    fireEvent.blur(campo);

    await vi.waitFor(() => expect(onAdicionar).toHaveBeenCalledWith("tiktok", "oficinaderro"));
  });

  it("sair do campo vazio nao chama onAdicionar", async () => {
    const onAdicionar = vi.fn();
    render(<ListaPerfisCitados {...PROPS_BASE} itens={[]} onAdicionar={onAdicionar} onRemover={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Instagram" }));
    fireEvent.blur(await screen.findByLabelText("Perfil no Instagram"));

    expect(onAdicionar).not.toHaveBeenCalled();
  });

  it("tirar um item salvo chama onRemover com o id certo", () => {
    const onRemover = vi.fn();
    render(
      <ListaPerfisCitados
        {...PROPS_BASE}
        itens={[{ id: 7, rede: "youtube", handle: "@canalreferencia" }]}
        onAdicionar={vi.fn()}
        onRemover={onRemover}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tirar youtube.com/@canalreferencia" }));
    expect(onRemover).toHaveBeenCalledWith(7);
  });

  it("no limite, os chips de adicionar somem", () => {
    const itens = Array.from({ length: 10 }, (_, i) => ({ id: i, rede: "instagram" as const, handle: `perfil${i}` }));
    render(<ListaPerfisCitados {...PROPS_BASE} itens={itens} onAdicionar={vi.fn()} onRemover={vi.fn()} />);
    expect(screen.queryByText("Adicionar outro:")).toBeNull();
  });
});
