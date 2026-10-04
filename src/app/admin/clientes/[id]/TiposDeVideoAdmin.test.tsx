/** A folha de tipos do admin (E46 PR 1, item 0 do #119): ressincroniza depois do refresh e a volta de uma troca que falha é por chave. */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const definir = vi.fn();
const voltar = vi.fn();
vi.mock("./acoes", () => ({ definirFormatoDaMarcaAction: (...a: unknown[]) => definir(...a), voltarFormatoAoDoClienteAction: (...a: unknown[]) => voltar(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn() }), usePathname: () => "/admin/clientes/1" }));
vi.mock("@/ui/useFolhaNoHistorico", () => ({ useFolhaNoHistorico: (_aberta: boolean, aoFechar: () => void) => ({ fechar: aoFechar }) }));

import { FORMATOS_DO_CATALOGO } from "@/config/formatos";

import { TiposDeVideoAdmin, type TipoDaMarcaParaAdmin } from "./TiposDeVideoAdmin";

function iniciais(troca: Partial<Record<string, boolean>> = {}): TipoDaMarcaParaAdmin[] {
  return FORMATOS_DO_CATALOGO.map((f) => ({ chave: f.chave, ligada: troca[f.chave] ?? f.ligadaPorPadrao, quem: "padrao", respostaDoCliente: null, decididoEmTexto: null, respostaDoClienteEmTexto: null }));
}

beforeEach(() => {
  definir.mockReset();
  voltar.mockReset();
});
afterEach(cleanup);

function chave(nome: string) {
  const lista = screen.getByRole("list", { name: /Tipos de vídeo/ });
  return within(lista).getByRole("switch", { name: nome });
}

const nomeDe = (c: string) => FORMATOS_DO_CATALOGO.find((f) => f.chave === c)!.nome;

describe("TiposDeVideoAdmin", () => {
  it("ressincroniza com o que o servidor mandou depois do refresh", () => {
    const { rerender } = render(<TiposDeVideoAdmin clienteId={1} nomeMarca="Marca" iniciais={iniciais()} />);
    fireEvent.click(screen.getByRole("button", { name: /Ver e ajustar/ }));
    const antes = chave(nomeDe("lista")).getAttribute("aria-checked") === "true";
    rerender(<TiposDeVideoAdmin clienteId={1} nomeMarca="Marca" iniciais={iniciais({ lista: !antes })} />);
    expect(chave(nomeDe("lista")).getAttribute("aria-checked")).toBe(String(!antes));
  });

  it("a troca que falha volta só a própria chave, mesmo com outra trocada depois", async () => {
    let soltaPrimeira: (v: { ok: boolean; erro?: string }) => void = () => {};
    definir.mockImplementationOnce(() => new Promise((r) => (soltaPrimeira = r)));
    definir.mockResolvedValueOnce({ ok: true, dado: null });
    render(<TiposDeVideoAdmin clienteId={1} nomeMarca="Marca" iniciais={iniciais()} />);
    fireEvent.click(screen.getByRole("button", { name: /Ver e ajustar/ }));
    const listaAntes = chave(nomeDe("lista")).getAttribute("aria-checked");
    const bastidorAntes = chave(nomeDe("bastidor")).getAttribute("aria-checked");
    fireEvent.click(chave(nomeDe("lista")));
    await act(async () => {
      fireEvent.click(chave(nomeDe("bastidor")));
    });
    await act(async () => {
      soltaPrimeira({ ok: false, erro: "falhou" });
    });
    expect(chave(nomeDe("lista")).getAttribute("aria-checked")).toBe(listaAntes);
    expect(chave(nomeDe("bastidor")).getAttribute("aria-checked")).toBe(bastidorAntes === "true" ? "false" : "true");
  });
});
