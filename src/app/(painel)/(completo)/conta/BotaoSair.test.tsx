/**
 * O botão "sair" e o aviso de manhã (A2, item 3): ao sair, a inscrição deste navegador é apagada no servidor ANTES de encerrar a sessão (a ação precisa
 * dela); sem inscrição neste aparelho nada é apagado; e uma falha ao apagar nunca impede a saída.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ordem: string[] = [];
const signOut = vi.fn(async () => {
  ordem.push("signOut");
  return { error: null };
});
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: () => signOut() } }));
vi.mock("@/lib/offline", () => ({
  limparCachesDoAparelho: async () => {
    ordem.push("limparCaches");
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/ui/ConexaoContext", () => ({ useTratarFalha: () => (_erro: unknown, padrao: string) => padrao }));

const inscricaoAtualDoAparelho = vi.fn();
vi.mock("@/ui/push", () => ({ inscricaoAtualDoAparelho: () => inscricaoAtualDoAparelho() }));

const apagarInscricaoPushAction = vi.fn();
vi.mock("@/app/(painel)/_casca/push-acoes", () => ({
  apagarInscricaoPushAction: (endpoint: string) => apagarInscricaoPushAction(endpoint),
}));

import { BotaoSair } from "./BotaoSair";

beforeEach(() => {
  ordem.length = 0;
  signOut.mockClear();
  inscricaoAtualDoAparelho.mockReset();
  apagarInscricaoPushAction.mockReset();
  apagarInscricaoPushAction.mockImplementation(async () => {
    ordem.push("apagarInscricao");
  });
});

afterEach(cleanup);

async function sair() {
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(signOut).toHaveBeenCalled());
}

describe("BotaoSair e a inscrição do aviso de manhã", () => {
  it("manda o endereço da inscrição deste navegador ao servidor antes de encerrar a sessão", async () => {
    inscricaoAtualDoAparelho.mockResolvedValue({ endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "p", auth: "a" });
    render(<BotaoSair />);

    await sair();

    expect(apagarInscricaoPushAction).toHaveBeenCalledWith("https://fcm.googleapis.com/fcm/send/x");
    expect(ordem.indexOf("apagarInscricao")).toBeLessThan(ordem.indexOf("signOut"));
  });

  it("sem inscrição neste aparelho, nada é apagado e a saída segue", async () => {
    inscricaoAtualDoAparelho.mockResolvedValue(null);
    render(<BotaoSair />);

    await sair();

    expect(apagarInscricaoPushAction).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("uma falha ao apagar a inscrição (sem rede, por exemplo) nunca impede a saída", async () => {
    inscricaoAtualDoAparelho.mockResolvedValue({ endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "p", auth: "a" });
    apagarInscricaoPushAction.mockRejectedValue(new Error("sem rede"));
    render(<BotaoSair />);

    await sair();

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("falha ao ler a inscrição do navegador também não impede a saída", async () => {
    inscricaoAtualDoAparelho.mockRejectedValue(new Error("sem service worker"));
    render(<BotaoSair />);

    await sair();

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
