/**
 * O chamado "Editar o meu vídeo" à vista no corpo do roteiro: o convite quando ainda não há edição, a linha do ponto em que ela está quando já existe, e o botão que abre a folha.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EstadoDaEdicao } from "@/db/schema";
import { linhaDoEstadoDaEdicao, textosEdicao } from "@/textos/edicao";

vi.mock("@/ui/ConexaoContext", () => ({
  ID_FAIXA_SEM_CONEXAO: "faixa-sem-conexao",
  useConexao: () => ({ semConexao: false, avisarRedeOk: vi.fn() }),
}));

import { ChamadoEditarMeuVideo } from "./ChamadoEditarMeuVideo";

const c = textosEdicao.chamado;

afterEach(() => cleanup());

describe("ChamadoEditarMeuVideo", () => {
  it("sem edição, convida a mandar o vídeo e abre a folha ao tocar no botão", () => {
    const aoAbrir = vi.fn();
    render(<ChamadoEditarMeuVideo estado={null} aoAbrir={aoAbrir} />);
    expect(screen.getByText(c.titulo)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: c.botao }));
    expect(aoAbrir).toHaveBeenCalledTimes(1);
  });

  it.each<[EstadoDaEdicao, string]>([
    ["guardado", c.montando],
    ["transcrevendo", c.montando],
    ["verificado", c.montando],
    ["montando_previa", c.montando],
    ["aprovada", c.montando],
    ["montando_final", c.montando],
    ["previa_pronta", c.previaPronta],
    ["pronta", c.pronto],
    ["para_revisao", c.conferindo],
  ])("edição em %s: diz a linha do ponto e o botão abre a edição", (estado, linha) => {
    const aoAbrir = vi.fn();
    render(<ChamadoEditarMeuVideo estado={estado} aoAbrir={aoAbrir} />);
    expect(screen.getByText(linha)).toBeTruthy();
    expect(screen.queryByText(c.titulo)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: c.botaoAbrir }));
    expect(aoAbrir).toHaveBeenCalledTimes(1);
  });

  it.each<EstadoDaEdicao>(["falhou", "expirada"])("edição em %s volta a convidar a mandar o vídeo", (estado) => {
    render(<ChamadoEditarMeuVideo estado={estado} aoAbrir={vi.fn()} />);
    expect(screen.getByText(c.titulo)).toBeTruthy();
    expect(screen.getByRole("button", { name: c.botao })).toBeTruthy();
  });

  it("a linha de cada ponto da edição é nula só quando não há o que dizer", () => {
    expect(linhaDoEstadoDaEdicao(null)).toBeNull();
    expect(linhaDoEstadoDaEdicao(undefined)).toBeNull();
    expect(linhaDoEstadoDaEdicao("falhou")).toBeNull();
    expect(linhaDoEstadoDaEdicao("subindo")).toBe(c.montando);
  });
});
