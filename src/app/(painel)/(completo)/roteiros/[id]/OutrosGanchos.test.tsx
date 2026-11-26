/**
 * "Outros ganchos" na tela do roteiro: o botão que pede, a lista com o tipo de abertura e a emoção, o toque que troca, o "voltar ao de antes", o "ver como" e o roteiro já gravado (só mostram).
 * As Server Actions, o roteador e o contexto de conexão saem simulados.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VisaoDosGanchos } from "@/servicos/ganchos-alternativos";
import { textosGanchos } from "@/textos/ganchos";

const pedirGanchosAction = vi.fn();
const trocarGanchoAction = vi.fn();
const refresh = vi.fn();

vi.mock("./ganchos-acoes", () => ({
  pedirGanchosAction: (...args: unknown[]) => pedirGanchosAction(...args),
  trocarGanchoAction: (...args: unknown[]) => trocarGanchoAction(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/ui/ConexaoContext", () => ({
  ID_FAIXA_SEM_CONEXAO: "faixa-sem-conexao",
  useConexao: () => ({ semConexao: false, avisarRedeOk: vi.fn() }),
  useTratarFalha: () => (_erro: unknown, padrao: string) => padrao,
}));

import { OutrosGanchos } from "./OutrosGanchos";

const t = textosGanchos;

function visao(extra: Partial<VisaoDosGanchos> = {}): VisaoDosGanchos {
  return {
    podeTrocar: true,
    atual: { texto: "Gancho de agora", tipoAbertura: "fala_direta" },
    alternativas: null,
    escolhido: null,
    original: null,
    verComo: false,
    fechado: false,
    ...extra,
  };
}

const comLista = (extra: Partial<VisaoDosGanchos> = {}) =>
  visao({
    alternativas: [
      { texto: "Olhe a mancha antes de eu encostar", tipoAbertura: "cena", emocao: "curiosidade" },
      { texto: "O sofá voltou a ficar claro", tipoAbertura: "resultado", emocao: "desejo" },
      { texto: "Você sabe tirar café do sofá?", tipoAbertura: "pergunta", emocao: "identificacao" },
    ],
    original: { texto: "Gancho de agora", tipoAbertura: "fala_direta" },
    ...extra,
  });

beforeEach(() => {
  pedirGanchosAction.mockReset();
  trocarGanchoAction.mockReset();
  refresh.mockReset();
});
afterEach(cleanup);

describe("OutrosGanchos", () => {
  it("o botão pede os ganchos e mostra a lista com o tipo de abertura e a emoção de cada um", async () => {
    pedirGanchosAction.mockResolvedValue({ ok: true, dado: { ganchos: comLista() } });
    render(<OutrosGanchos roteiroId={5} visao={visao()} />);
    fireEvent.click(screen.getByRole("button", { name: t.botao }));
    await waitFor(() => expect(screen.getByText("Olhe a mancha antes de eu encostar")).toBeTruthy());
    expect(pedirGanchosAction).toHaveBeenCalledWith(5);
    expect(screen.getByText("Mostra uma cena")).toBeTruthy();
    expect(screen.getByText("Curiosidade")).toBeTruthy();
    expect(screen.getByText("Começa pelo resultado")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: t.usar })).toHaveLength(3);
  });

  it("a falha do servidor aparece com a frase dele e o roteiro não muda", async () => {
    pedirGanchosAction.mockResolvedValue({ ok: false, erro: t.frases["ia-fora"] });
    render(<OutrosGanchos roteiroId={5} visao={visao()} />);
    fireEvent.click(screen.getByRole("button", { name: t.botao }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(t.frases["ia-fora"]));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("o toque em 'Usar este gancho' troca (índice certo), avisa e atualiza a tela do roteiro", async () => {
    trocarGanchoAction.mockResolvedValue({ ok: true, dado: { ganchos: comLista({ escolhido: 1, atual: { texto: "O sofá voltou a ficar claro", tipoAbertura: "resultado" } }) } });
    render(<OutrosGanchos roteiroId={5} visao={comLista()} />);
    fireEvent.click(screen.getByRole("button", { name: t.botaoAbrir }));
    fireEvent.click(screen.getAllByRole("button", { name: t.usar })[1]);
    await waitFor(() => expect(trocarGanchoAction).toHaveBeenCalledWith(5, 1));
    await waitFor(() => expect(screen.getByText(t.trocou)).toBeTruthy());
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText(t.usando)).toBeTruthy();
    expect(screen.getByText(t.deAntes)).toBeTruthy();
  });

  it("'Voltar ao gancho de antes' manda 'original'", async () => {
    trocarGanchoAction.mockResolvedValue({ ok: true, dado: { ganchos: comLista() } });
    render(<OutrosGanchos roteiroId={5} visao={comLista({ escolhido: 0 })} />);
    fireEvent.click(screen.getByRole("button", { name: t.botaoAbrir }));
    fireEvent.click(screen.getByRole("button", { name: t.voltar }));
    await waitFor(() => expect(trocarGanchoAction).toHaveBeenCalledWith(5, "original"));
  });

  it("no 'ver como' não há botão de pedir nem de trocar, só o aviso", () => {
    render(<OutrosGanchos roteiroId={5} visao={visao({ verComo: true })} />);
    expect(screen.queryByRole("button", { name: t.botao })).toBeNull();
    expect(screen.getByText(t.aviso.verComo)).toBeTruthy();
    cleanup();
    render(<OutrosGanchos roteiroId={5} visao={comLista({ verComo: true })} />);
    fireEvent.click(screen.getByRole("button", { name: t.botaoAbrir }));
    expect(screen.queryByRole("button", { name: t.usar })).toBeNull();
  });

  it("com o roteiro já gravado a lista só mostra, sem trocar, e diz por quê", () => {
    render(<OutrosGanchos roteiroId={5} visao={comLista({ fechado: true })} />);
    expect(screen.getByText(t.aviso.fechado)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.botaoAbrir }));
    expect(screen.queryByRole("button", { name: t.usar })).toBeNull();
  });
});
