/**
 * "Contas fora do setor" no admin do ramo (faxina das contas, 22/10/2026): a lista com o motivo e quem decidiu, "voltar para o setor", "conferir as contas agora" e o "tirar do setor" ao lado
 * de cada conta da vigilância. As Server Actions e o roteador saem mockados: o que importa é o que a tela mostra e chama.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContaMarcadaFora } from "@/servicos/contas-fora-do-setor";

const conferirAcao = vi.fn();
const tirarAcao = vi.fn();
const voltarAcao = vi.fn();
const atualizarRota = vi.fn();

vi.mock("../acoes", () => ({
  conferirContasAgoraAction: (...args: unknown[]) => conferirAcao(...args),
  tirarContaDoSetorAction: (...args: unknown[]) => tirarAcao(...args),
  voltarContaParaOSetorAction: (...args: unknown[]) => voltarAcao(...args),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: atualizarRota }) }));

import { BotaoTirarDoSetor, ContasForaDoSetor } from "./ContasForaDoSetor";

beforeEach(() => {
  conferirAcao.mockReset().mockResolvedValue({ ok: true, mensagem: "" });
  tirarAcao.mockReset().mockResolvedValue({ ok: true });
  voltarAcao.mockReset().mockResolvedValue({ ok: true });
  atualizarRota.mockReset();
});
afterEach(cleanup);

const conta = (contaId: number, extra: Partial<ContaMarcadaFora> = {}): ContaMarcadaFora => ({
  contaId,
  plataforma: "youtube",
  handle: `conta${contaId}`,
  nome: null,
  origem: "automatica",
  motivo: "6 de 8 vídeos conferidos são de outro assunto (por exemplo: Curiosidade um)",
  videosConferidos: 8,
  videosForaDoSetor: 6,
  marcadaEm: new Date("2026-10-18T12:00:00Z"),
  ...extra,
});

describe("ContasForaDoSetor", () => {
  it("lista a conta com o motivo, quem decidiu e desde quando; a marca à mão diz que foi o admin", () => {
    render(<ContasForaDoSetor nichoId={5} slug="empreendedorismo" contas={[conta(1), conta(2, { origem: "manual", motivo: "tirada do ramo à mão", videosConferidos: null, videosForaDoSetor: null })]} />);
    const linha1 = screen.getByText("conta1").closest("tr")!;
    expect(within(linha1).getByText(/6 de 8 vídeos conferidos são de outro assunto/)).toBeTruthy();
    expect(within(linha1).getByText("a conferência")).toBeTruthy();
    const linha2 = screen.getByText("conta2").closest("tr")!;
    expect(within(linha2).getByText("você")).toBeTruthy();
    expect(within(linha2).getByText("tirada do ramo à mão")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "contas fora do setor" })).toBeTruthy();
  });

  it("sem conta marcada, diz que não há nenhuma", () => {
    render(<ContasForaDoSetor nichoId={5} slug="empreendedorismo" contas={[]} />);
    expect(screen.getByText("nenhuma conta fora do setor neste ramo.")).toBeTruthy();
  });

  it("'voltar para o setor' chama a ação com a conta e o ramo, e relê a tela", async () => {
    render(<ContasForaDoSetor nichoId={5} slug="empreendedorismo" contas={[conta(1), conta(2)]} />);
    const linha = screen.getByText("conta2").closest("tr")!;
    fireEvent.click(within(linha).getByRole("button", { name: "voltar para o setor" }));
    await waitFor(() => expect(voltarAcao).toHaveBeenCalledWith(2, 5, "empreendedorismo"));
    await waitFor(() => expect(atualizarRota).toHaveBeenCalled());
  });

  it("quando a ação falha, a tela avisa", async () => {
    voltarAcao.mockResolvedValue({ ok: false, mensagem: "x" });
    render(<ContasForaDoSetor nichoId={5} slug="empreendedorismo" contas={[conta(1)]} />);
    fireEvent.click(screen.getByRole("button", { name: "voltar para o setor" }));
    expect(await screen.findByText("não conseguimos mudar a conta agora; tente de novo")).toBeTruthy();
  });

  it("'conferir as contas agora' pede a conferência só deste ramo e diz que foi pedida", async () => {
    render(<ContasForaDoSetor nichoId={5} slug="empreendedorismo" contas={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "conferir as contas agora" }));
    await waitFor(() => expect(conferirAcao).toHaveBeenCalledWith(5));
    expect(await screen.findByText("pedido; a conferência das contas deste ramo começa em instantes")).toBeTruthy();
  });

  it("conferência já na fila e falha de fila têm frase própria", async () => {
    conferirAcao.mockResolvedValueOnce({ ok: true, mensagem: "", duplicado: true });
    render(<ContasForaDoSetor nichoId={5} slug="empreendedorismo" contas={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "conferir as contas agora" }));
    expect(await screen.findByText("já tem uma conferência rodando para este ramo")).toBeTruthy();

    conferirAcao.mockResolvedValueOnce({ ok: false, mensagem: "fila fora" });
    fireEvent.click(screen.getByRole("button", { name: "conferir as contas agora" }));
    expect(await screen.findByText("não conseguimos pedir a conferência: fila fora")).toBeTruthy();
  });
});

describe("BotaoTirarDoSetor", () => {
  it("chama a ação com a conta, o ramo e o endereço, e o botão diz de qual conta é", async () => {
    render(<BotaoTirarDoSetor contaId={9} nichoId={5} slug="empreendedorismo" handle="curiosidades" />);
    fireEvent.click(screen.getByRole("button", { name: "tirar do setor: curiosidades" }));
    await waitFor(() => expect(tirarAcao).toHaveBeenCalledWith(9, 5, "empreendedorismo"));
    await waitFor(() => expect(atualizarRota).toHaveBeenCalled());
  });

  it("quando a ação falha, avisa ao lado do botão", async () => {
    tirarAcao.mockResolvedValue({ ok: false, mensagem: "x" });
    render(<BotaoTirarDoSetor contaId={9} nichoId={5} slug="empreendedorismo" handle="curiosidades" />);
    fireEvent.click(screen.getByRole("button", { name: "tirar do setor: curiosidades" }));
    expect(await screen.findByText("não conseguimos mudar a conta agora; tente de novo")).toBeTruthy();
  });
});
