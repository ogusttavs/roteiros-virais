/**
 * O botão de assinar da folha do limite do teste chama `assinarAgoraAction` (não leva mais a `/assinar`): vai ao endereço devolvido, ou mostra a frase do erro e libera o botão.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assinarAgoraAction = vi.fn();
vi.mock("@/app/(painel)/assinar/acoes", () => ({ assinarAgoraAction: () => assinarAgoraAction() }));

import { BotaoAssinarAgora } from "./BotaoAssinarAgora";

const assign = vi.fn();
beforeEach(() => {
  assinarAgoraAction.mockReset();
  assign.mockReset();
  vi.stubGlobal("location", { assign });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BotaoAssinarAgora", () => {
  it("é um botão (não um link para /assinar) e chama a ação de assinar agora, indo ao endereço devolvido", async () => {
    assinarAgoraAction.mockResolvedValue({ ok: true, dado: { url: "/assinar?assinou=1&agora=1" } });
    render(<BotaoAssinarAgora rotulo="Assinar por R$ 1.191 a cada 3 meses" />);
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Assinar por R$ 1.191 a cada 3 meses" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/assinar?assinou=1&agora=1"));
    expect(assinarAgoraAction).toHaveBeenCalledTimes(1);
  });

  it("cartão recusado: mostra a frase, não sai da folha e libera o botão", async () => {
    assinarAgoraAction.mockResolvedValue({ ok: false, erro: "O cartão foi recusado." });
    render(<BotaoAssinarAgora rotulo="Assinar" />);
    fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("O cartão foi recusado.");
    expect(assign).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Assinar" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
