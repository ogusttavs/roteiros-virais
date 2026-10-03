/**
 * `ContextoMarcaCard` (E38 PR 2): o que o e2e não alcança com precisão e o que a revisão achou em
 * simulação: o cartão relê a seção quando o servidor traz outra (o botão de atualizar do celular), a
 * confirmação vai com o texto que a pessoa viu, a linha volta quando a ação falha, o foco acompanha o
 * campo de correção, os botões dizem de qual item são, e salvar um item não fecha a correção de outro.
 *
 * As Server Actions, o contexto de conexão, o roteador e o gravador de voz saem mockados: o que importa
 * aqui é só o que o cartão faz com o que elas devolvem.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ItemDaSecao, SecaoContextoMarca } from "@/servicos/contexto-marca";

/** Se a rede está fora: o mock de `useConexao` lê daqui (precisa ser criado com `vi.hoisted`, que roda antes dos `vi.mock`). */
const estadoDaRede = vi.hoisted(() => ({ semConexao: false }));
/** Os `onTranscrito` que o gravador de voz recebeu (um por campo de correção montado): o teste chama um depois de o campo ter fechado. */
const transcritos = vi.hoisted(() => [] as ((texto: string, duracaoS: number) => void)[]);

const confirmarAcao = vi.fn();
const corrigirAcao = vi.fn();
const tirarAcao = vi.fn();
const desfazerAcao = vi.fn();
const atualizarRota = vi.fn();

vi.mock("./acoes", () => ({
  confirmarItemContextoAction: (...args: unknown[]) => confirmarAcao(...args),
  corrigirItemContextoAction: (...args: unknown[]) => corrigirAcao(...args),
  tirarItemContextoAction: (...args: unknown[]) => tirarAcao(...args),
  desfazerTirarItemContextoAction: (...args: unknown[]) => desfazerAcao(...args),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: atualizarRota }) }));

vi.mock("@/ui/ConexaoContext", () => ({
  ID_FAIXA_SEM_CONEXAO: "faixa-sem-conexao",
  useConexao: () => ({ semConexao: estadoDaRede.semConexao, avisarRedeOk: vi.fn() }),
  useTratarFalha: () => (_erro: unknown, padrao: string) => padrao,
}));

vi.mock("@/ui/componentes/useGravadorDeAudio", () => ({
  LIMITE_SEGUNDOS_PADRAO: 120,
  useGravadorDeAudio: (opcoes: { onTranscrito: (texto: string, duracaoS: number) => void }) => {
    transcritos.push(opcoes.onTranscrito);
    return { fase: "inicial", segundos: 0, semMicrofone: false, erro: null, iniciarGravacao: vi.fn(), pararGravacao: vi.fn() };
  },
}));

import { ContextoMarcaCard } from "./ContextoMarcaCard";

function item(id: number, texto: string, extra: Partial<ItemDaSecao> = {}): ItemDaSecao {
  return { id, categoria: "vende", origem: "site", estado: "para_confirmar", texto, valiaAntes: null, novidade: null, ...extra };
}

function secao(extra: Partial<SecaoContextoMarca> = {}): SecaoContextoMarca {
  return {
    estado: "ok",
    itens: [],
    tirados: [],
    versao: "v1",
    fontes: [{ tipo: "site", lida: true, quantidade: 3 }],
    tiktokGuardado: false,
    ultimaLeituraOkEm: new Date("2026-09-20T12:00:00Z"),
    proximaLeituraEm: new Date("2026-10-20T12:00:00Z"),
    ...extra,
  };
}

beforeEach(() => {
  estadoDaRede.semConexao = false;
  transcritos.length = 0;
  confirmarAcao.mockReset().mockResolvedValue("confirmado");
  corrigirAcao.mockReset().mockResolvedValue(undefined);
  tirarAcao.mockReset().mockResolvedValue(undefined);
  desfazerAcao.mockReset().mockResolvedValue(undefined);
  atualizarRota.mockReset();
});

afterEach(cleanup);

describe("a seção que o servidor traz de novo", () => {
  it("de 'lendo' para 'ok com itens' (o botão de atualizar do celular): mostra os itens, nunca 'não achou nada claro'", () => {
    const { rerender } = render(<ContextoMarcaCard secao={secao({ estado: "lendo", versao: "a" })} />);
    expect(screen.getByText(/Estamos lendo o que a sua marca mostra/)).toBeTruthy();

    rerender(<ContextoMarcaCard secao={secao({ estado: "ok", versao: "b", itens: [item(1, "Vende removedor de manchas."), item(2, "Posta antes e depois.", { categoria: "posta" })] })} />);

    expect(screen.getByText("Vende removedor de manchas.")).toBeTruthy();
    expect(screen.getByText("Posta antes e depois.")).toBeTruthy();
    expect(screen.queryByText(/não achou nada claro/)).toBeNull();
    expect(screen.queryByText(/Estamos lendo/)).toBeNull();
  });

  it("a mesma versão não apaga a decisão que a pessoa acabou de tomar na tela", async () => {
    const { rerender } = render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Vende removedor de manchas.")] })} />);
    fireEvent.click(screen.getByRole("button", { name: /^Está certo/ }));
    await waitFor(() => expect(screen.getByText("Confirmado")).toBeTruthy());

    rerender(<ContextoMarcaCard secao={secao({ itens: [item(1, "Vende removedor de manchas.")] })} />);

    expect(screen.getByText("Confirmado")).toBeTruthy();
  });
});

describe("estados com itens e sem itens", () => {
  it("sem fonte na Conta, o que a pessoa confirmou continua à vista (ainda alimenta os roteiros)", () => {
    render(
      <ContextoMarcaCard
        secao={secao({ estado: "sem_fonte", fontes: [], itens: [item(1, "Vende removedor.", { estado: "confirmado" })] })}
      />,
    );
    expect(screen.getByText(/guarde em Conta o site da sua marca/)).toBeTruthy();
    expect(screen.getByText("Vende removedor.")).toBeTruthy();
    expect(screen.getByText("Confirmado")).toBeTruthy();
  });

  it("leitura boa sem itens: 'não achou nada claro'; com itens tirados, 'não sobrou nada' (e a lista dos tirados)", () => {
    const { rerender } = render(<ContextoMarcaCard secao={secao()} />);
    expect(screen.getByText(/A gente leu, mas não achou nada claro/)).toBeTruthy();

    rerender(<ContextoMarcaCard secao={secao({ versao: "b", tirados: [{ id: 9, categoria: "vende", origem: "site", texto: "Fala formal." }] })} />);
    expect(screen.getByText(/Não sobrou nada para confirmar/)).toBeTruthy();
    expect(screen.queryByText(/não achou nada claro/)).toBeNull();
    expect(screen.getByText("1 item que você tirou")).toBeTruthy();
  });

  it("proposta nova por cima de um texto confirmado: mostra a proposta, o rótulo certo e o que continua valendo", () => {
    render(
      <ContextoMarcaCard
        secao={secao({ itens: [item(1, "Agora também vende amaciante.", { novidade: "mudou", valiaAntes: "Vende só removedor." })] })}
      />,
    );
    expect(screen.getByText("mudou desde a última leitura")).toBeTruthy();
    expect(screen.getByText(/Até você decidir, nos seus roteiros continua valendo/)).toBeTruthy();
    expect(screen.getByText(/Vende só removedor\./)).toBeTruthy();
  });
});

describe("Está certo", () => {
  it("vai com o texto que a pessoa viu, e a linha vira Confirmado", async () => {
    render(<ContextoMarcaCard secao={secao({ itens: [item(7, "Vende removedor de manchas.")] })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Está certo/ }));

    await waitFor(() => expect(screen.getByText("Confirmado")).toBeTruthy());
    expect(confirmarAcao).toHaveBeenCalledWith(7, "Vende removedor de manchas.");
  });

  it("a proposta trocou enquanto a página estava aberta: a linha volta, a frase aparece, a seção é buscada de novo, e a frase sobrevive à leitura nova", async () => {
    confirmarAcao.mockResolvedValue("mudou");
    const { rerender } = render(<ContextoMarcaCard secao={secao({ itens: [item(7, "Texto antigo.")] })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Está certo/ }));

    await waitFor(() => expect(screen.getByText(/Esta leitura mudou enquanto você olhava/)).toBeTruthy());
    expect(atualizarRota).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Confirmado")).toBeNull();
    expect(screen.getByRole("button", { name: /^Está certo/ })).toBeTruthy();

    // O servidor traz a seção nova (texto trocado): o cartão a mostra, e a frase continua embaixo do item.
    rerender(<ContextoMarcaCard secao={secao({ versao: "b", itens: [item(7, "Texto novo.")] })} />);
    expect(screen.getByText("Texto novo.")).toBeTruthy();
    expect(screen.queryByText("Texto antigo.")).toBeNull();
    expect(screen.getByText(/Esta leitura mudou enquanto você olhava/)).toBeTruthy();
  });

  it("a ação falha: a linha volta ao que era e a frase de erro aparece embaixo dela", async () => {
    confirmarAcao.mockRejectedValue(new Error("rede caiu"));
    render(<ContextoMarcaCard secao={secao({ itens: [item(7, "Vende removedor.")] })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Está certo/ }));

    await waitFor(() => expect(screen.getByText("Não conseguimos confirmar agora. Tente de novo em instantes.")).toBeTruthy());
    expect(screen.queryByText("Confirmado")).toBeNull();
    expect(screen.getByRole("button", { name: /^Está certo/ })).toBeTruthy();
  });
});

describe("os botões e o foco", () => {
  it("cada botão leva no nome o começo do texto do item (vários 'Está certo' e 'Corrigir' na mesma tela)", () => {
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Vende removedor."), item(2, "Posta antes e depois.", { categoria: "posta" })] })} />);

    expect(screen.getByRole("button", { name: "Está certo: Vende removedor." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Corrigir: Posta antes e depois." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tirar: Vende removedor." })).toBeTruthy();
  });

  it("Corrigir leva o foco ao campo; Cancelar devolve o foco ao botão Corrigir do mesmo item", async () => {
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Vende removedor.")] })} />);
    const corrigir = screen.getByRole("button", { name: "Corrigir: Vende removedor." });

    fireEvent.click(corrigir);
    const campo = (await screen.findByLabelText("Corrigir o que a IA entendeu")) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(campo));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Corrigir: Vende removedor." })));
  });

  it("o resultado é anunciado numa região de status, e o foco vai para um botão que ainda existe", async () => {
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Vende removedor.")] })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Está certo/ }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Item confirmado."));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Corrigir/ })));
  });
});

describe("Corrigir", () => {
  it("texto vazio e texto acima do limite não chamam o servidor e mostram a frase certa no próprio campo", async () => {
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Vende removedor.")] })} />);
    fireEvent.click(screen.getByRole("button", { name: /^Corrigir/ }));
    const campo = (await screen.findByLabelText("Corrigir o que a IA entendeu")) as HTMLTextAreaElement;

    fireEvent.change(campo, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByText("Escreva o que está certo, ou toque em Cancelar.")).toBeTruthy();

    fireEvent.change(campo, { target: { value: "a".repeat(501) } });
    expect(screen.getByText("501 de 500 caracteres")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByText(/Passou de 500 caracteres/)).toBeTruthy();
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    expect(campo.value).toHaveLength(501);

    expect(corrigirAcao).not.toHaveBeenCalled();
  });

  it("salvar a correção de um item não fecha o campo de correção que a pessoa abriu em outro enquanto o primeiro salvava", async () => {
    let terminarOPrimeiro: () => void = () => undefined;
    corrigirAcao.mockImplementationOnce(() => new Promise<void>((resolver) => (terminarOPrimeiro = resolver)));
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Primeiro item."), item(2, "Segundo item.", { categoria: "fala" })] })} />);

    fireEvent.click(screen.getByRole("button", { name: "Corrigir: Primeiro item." }));
    fireEvent.change(await screen.findByLabelText("Corrigir o que a IA entendeu"), { target: { value: "Primeiro corrigido." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    // Enquanto o primeiro salva, abre a correção do segundo e começa a escrever.
    fireEvent.click(screen.getByRole("button", { name: "Corrigir: Segundo item." }));
    fireEvent.change(await screen.findByLabelText("Corrigir o que a IA entendeu"), { target: { value: "Segundo, ainda escrevendo" } });

    await act(async () => {
      terminarOPrimeiro();
    });

    const campo = (await screen.findByLabelText("Corrigir o que a IA entendeu")) as HTMLTextAreaElement;
    expect(campo.value).toBe("Segundo, ainda escrevendo");
    expect(screen.getByText("Primeiro corrigido.")).toBeTruthy();
  });

  it("abrir a correção de outro item tira do primeiro a frase 'o que você escreveu continua aí', que deixou de ser verdade", async () => {
    corrigirAcao.mockRejectedValueOnce(new Error("rede caiu"));
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Primeiro item."), item(2, "Segundo item.", { categoria: "fala" })] })} />);

    fireEvent.click(screen.getByRole("button", { name: "Corrigir: Primeiro item." }));
    fireEvent.change(await screen.findByLabelText("Corrigir o que a IA entendeu"), { target: { value: "Algo novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(screen.getByText(/O que você escreveu continua aí/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Corrigir: Segundo item." }));

    await waitFor(() => expect(screen.queryByText(/O que você escreveu continua aí/)).toBeNull());
  });
});

describe("o que chega depois de a pessoa ter mudado de campo", () => {
  it("uma transcrição de voz que chega depois de o campo fechar não o reabre", async () => {
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Primeiro item.")] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Corrigir: Primeiro item." }));
    await screen.findByLabelText("Corrigir o que a IA entendeu");
    const doPrimeiro = transcritos[transcritos.length - 1];
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText("Corrigir o que a IA entendeu")).toBeNull();

    act(() => doPrimeiro("texto que chegou atrasado", 5));

    expect(screen.queryByLabelText("Corrigir o que a IA entendeu")).toBeNull();
  });

  it("a transcrição atrasada de um item não troca o rascunho que a pessoa está escrevendo em outro", async () => {
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Primeiro item."), item(2, "Segundo item.", { categoria: "fala" })] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Corrigir: Primeiro item." }));
    await screen.findByLabelText("Corrigir o que a IA entendeu");
    const doPrimeiro = transcritos[transcritos.length - 1];

    fireEvent.click(screen.getByRole("button", { name: "Corrigir: Segundo item." }));
    fireEvent.change(await screen.findByLabelText("Corrigir o que a IA entendeu"), { target: { value: "Rascunho do segundo" } });
    act(() => doPrimeiro("texto atrasado do primeiro", 5));

    expect((screen.getByLabelText("Corrigir o que a IA entendeu") as HTMLTextAreaElement).value).toBe("Rascunho do segundo");
  });

  it("a ação de um item falha depois de a pessoa abrir a correção de outro: a frase não promete um texto que já não está no campo", async () => {
    let falharOPrimeiro: (erro: Error) => void = () => undefined;
    corrigirAcao.mockImplementationOnce(() => new Promise<void>((_resolver, rejeitar) => (falharOPrimeiro = rejeitar)));
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Primeiro item."), item(2, "Segundo item.", { categoria: "fala" })] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Corrigir: Primeiro item." }));
    fireEvent.change(await screen.findByLabelText("Corrigir o que a IA entendeu"), { target: { value: "Primeiro corrigido" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    fireEvent.click(screen.getByRole("button", { name: "Corrigir: Segundo item." }));
    await screen.findByLabelText("Corrigir o que a IA entendeu");

    await act(async () => {
      falharOPrimeiro(new Error("rede caiu"));
    });

    expect(await screen.findByText(/Toque em Corrigir neste item e escreva de novo/)).toBeTruthy();
    expect(screen.queryByText(/O que você escreveu continua aí/)).toBeNull();
  });
});

describe("leitor de tela e teclado, depois de uma falha", () => {
  it("a mesma frase anunciada duas vezes seguidas troca o nó (senão o leitor de tela fica mudo na segunda)", async () => {
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Primeiro item."), item(2, "Segundo item.", { categoria: "fala" })] })} />);

    fireEvent.click(screen.getByRole("button", { name: "Está certo: Primeiro item." }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Item confirmado."));
    const primeiroNo = screen.getByRole("status").firstElementChild;

    fireEvent.click(screen.getByRole("button", { name: "Está certo: Segundo item." }));
    await waitFor(() => expect(screen.getByRole("status").firstElementChild).not.toBe(primeiroNo));
    expect(screen.getByRole("status").textContent).toBe("Item confirmado.");
  });

  it("depois de uma falha de 'Está certo', 'Tirar' e 'Desfazer', o foco volta ao botão que a pessoa tinha tocado", async () => {
    confirmarAcao.mockRejectedValueOnce(new Error("rede caiu"));
    tirarAcao.mockRejectedValueOnce(new Error("rede caiu"));
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Vende removedor.")] })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Está certo/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Está certo/ })));

    fireEvent.click(screen.getByRole("button", { name: /^Tirar/ }));
    await waitFor(() => expect(screen.getByText(/Não conseguimos tirar agora/)).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Tirar/ })));
  });

  it("o contador de caracteres mede o texto que vai ser guardado (espaços juntados), o mesmo que o servidor mede", async () => {
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Vende removedor.")] })} />);
    fireEvent.click(screen.getByRole("button", { name: /^Corrigir/ }));
    const campo = await screen.findByLabelText("Corrigir o que a IA entendeu");

    fireEvent.change(campo, { target: { value: "a    b\n\n\nc" } });

    expect(screen.getByText("5 de 500 caracteres")).toBeTruthy();
  });
});

describe("sem conexão", () => {
  it("os botões que chamam o servidor ficam desabilitados, e clicar não chama nenhuma ação", () => {
    estadoDaRede.semConexao = true;
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Vende removedor.")], tirados: [{ id: 9, categoria: "vende", origem: "site", texto: "Fala formal." }] })} />);

    for (const nome of ["Está certo: Vende removedor.", "Corrigir: Vende removedor.", "Tirar: Vende removedor.", "Desfazer: Fala formal."]) {
      const botao = screen.getByRole("button", { name: nome }) as HTMLButtonElement;
      expect(botao.disabled, nome).toBe(true);
      fireEvent.click(botao);
    }
    expect(confirmarAcao).not.toHaveBeenCalled();
    expect(tirarAcao).not.toHaveBeenCalled();
    expect(desfazerAcao).not.toHaveBeenCalled();
  });
});

describe("Tirar e Desfazer", () => {
  it("Tirar risca a linha com Desfazer; Desfazer devolve o que era", async () => {
    render(<ContextoMarcaCard secao={secao({ itens: [item(1, "Vende removedor.", { estado: "confirmado" })] })} />);

    fireEvent.click(screen.getByRole("button", { name: "Tirar: Vende removedor." }));
    await waitFor(() => expect(screen.getByText("Tirado. Não entra nos seus roteiros.")).toBeTruthy());
    expect(tirarAcao).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole("button", { name: "Desfazer: Vende removedor." }));
    await waitFor(() => expect(screen.getByText("Confirmado")).toBeTruthy());
    expect(desfazerAcao).toHaveBeenCalledWith(1);
  });

  it("Desfazer da lista dos tirados chama o servidor e busca a seção de novo", async () => {
    render(<ContextoMarcaCard secao={secao({ tirados: [{ id: 9, categoria: "vende", origem: "site", texto: "Fala formal." }] })} />);

    const lista = screen.getByText("1 item que você tirou").closest("details")!;
    fireEvent.click(within(lista).getByRole("button", { name: "Desfazer: Fala formal." }));

    await waitFor(() => expect(desfazerAcao).toHaveBeenCalledWith(9));
    await waitFor(() => expect(atualizarRota).toHaveBeenCalledTimes(1));
  });
});
