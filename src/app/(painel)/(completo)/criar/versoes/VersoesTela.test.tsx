/**
 * `VersoesTela` (E26 4b, parte 2): o que a tela de comparar faz com o que o servidor devolve. O e2e prova o caminho inteiro; aqui ficam as regras de tela que ele não prova com precisão: a
 * nota que ordena é a do objetivo, "Nota mais alta" é só da primeira com nota, a versão sem nota diz que não deu, a nova entra no fim marcada "Nova" sem reordenar, a versão que já virou
 * roteiro leva o selo e o link em vez do botão, e as frases de erro ficam na tela.
 *
 * As Server Actions e o contexto de conexão saem mockados.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gerarOutraVersaoAction = vi.fn();
const ficarComVersaoAction = vi.fn();
const empurrar = vi.fn();
const atualizar = vi.fn();

vi.mock("./acoes", () => ({
  gerarOutraVersaoAction: (...args: unknown[]) => gerarOutraVersaoAction(...args),
  ficarComVersaoAction: (...args: unknown[]) => ficarComVersaoAction(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: empurrar, refresh: atualizar }) }));
vi.mock("@/ui/ConexaoContext", () => ({
  ID_FAIXA_SEM_CONEXAO: "faixa-sem-conexao",
  useConexao: () => ({ semConexao: false, avisarRedeOk: vi.fn() }),
  useTratarFalha: () => (_erro: unknown, padrao: string) => padrao,
}));

import type { VersaoParaTela } from "@/servicos/versoes";

import { VersoesTela } from "./VersoesTela";

function versao(id: number, nome: string, notas: VersaoParaTela["notas"], extra: Partial<VersaoParaTela> = {}): VersaoParaTela {
  return {
    id,
    ordem: id,
    nome,
    duracaoS: 40,
    notas,
    notaEmAndamento: false,
    blocos: [
      { tempo: "0 a 3 s", rotulo: "Os 3 primeiros segundos", linhas: [`gancho de ${nome}`] },
      { tempo: "3 a 26 s", rotulo: "O meio", linhas: [`meio de ${nome}`] },
    ],
    roteiroId: null,
    ...extra,
  };
}

const NOTAS = (viralizar: number, chamarem: number, lembrarem: number) => ({
  viralizar,
  chamarem,
  lembrarem,
  fraseDoObjetivo: "responde uma dúvida que aparece bem antes da compra.",
  jeitoDiferente: "começa mostrando a mancha voltando, sem falar nada.",
});

const PROPS = {
  grupo: "11111111-2222-3333-4444-555555555555",
  tema: "O erro que faz a mancha voltar",
  formato: "Reels, para o Instagram, o TikTok e o Shorts",
  paraQue: "Para que te chamem",
  chaveDaNota: "chamarem" as const,
  escolheuOObjetivo: true,
  trocarObjetivoHref: "/criar/objetivo?tema=0",
  meta: 9,
  versoes: [versao(1, "Demonstração direta", NOTAS(8.2, 9.1, 7.6)), versao(2, "A pergunta comum", NOTAS(9, 8.4, 7.1)), versao(3, "O custo de limpar duas vezes", NOTAS(5.8, 7.9, 8.8))],
};

beforeEach(() => {
  gerarOutraVersaoAction.mockReset();
  ficarComVersaoAction.mockReset();
  empurrar.mockReset();
  atualizar.mockReset();
});

afterEach(cleanup);

function folha(nome: string): HTMLElement {
  return screen.getByRole("article", { name: new RegExp(nome) });
}

describe("a comparação das versões", () => {
  it("mostra o tema, a ordem pela nota do objetivo, a nota em destaque e as outras duas pequenas", () => {
    render(<VersoesTela {...PROPS} />);

    // O h1 é o título da tela, antes do tema (que não é um título: a ordem dos títulos fica certa para o leitor de tela).
    expect(screen.getByRole("heading", { level: 1, name: "Escolha uma versão" })).toBeTruthy();
    expect(screen.getByText("O erro que faz a mancha voltar")).toBeTruthy();
    expect(screen.getByText("Ordenadas pela chance de te chamarem para comprar, que é o objetivo que você escolheu.")).toBeTruthy();
    const primeira = folha("Versão 1 de 3: Demonstração direta");
    expect(within(primeira).getByText("Nota mais alta")).toBeTruthy();
    expect(within(primeira).getByText("é o que você escolheu")).toBeTruthy();
    // "Na meta" pela nota 9,1 (meta 9), com a frase do juiz; as outras duas em "Viralizar 8,2" e "Lembrarem de você 7,6".
    expect(within(primeira).getByText("Na meta. Responde uma dúvida que aparece bem antes da compra.")).toBeTruthy();
    expect(within(primeira).getByText("8,2")).toBeTruthy();
    expect(within(primeira).getByText("7,6")).toBeTruthy();
    // Só a primeira leva o selo.
    expect(screen.getAllByText("Nota mais alta")).toHaveLength(1);
    // O roteiro inteiro, com o tempo de cada bloco, e a razão de ser diferente.
    expect(within(primeira).getByText("0 a 3 s")).toBeTruthy();
    expect(within(primeira).getByText("gancho de Demonstração direta")).toBeTruthy();
    expect(within(primeira).getByText("começa mostrando a mancha voltando, sem falar nada.")).toBeTruthy();
    // O rótulo descreve o jeito da versão, nunca promete comparação (o juiz vê uma versão de cada vez).
    expect(within(primeira).getByText("O jeito desta versão:")).toBeTruthy();
    expect(screen.queryByText(/Por que é diferente/)).toBeNull();
  });

  it("a versão sem nota e escrita há pouco diz que a nota está sendo calculada, não que não deu", () => {
    render(<VersoesTela {...PROPS} versoes={[versao(1, "Com juiz", NOTAS(7, 7, 7)), versao(2, "Esperando o juiz", null, { notaEmAndamento: true })]} />);

    const esperando = folha("Versão 2 de 2: Esperando o juiz");
    expect(within(esperando).getByText(/ainda está sendo calculada/)).toBeTruthy();
    expect(within(esperando).queryByText(/Não deu para dar a nota/)).toBeNull();
  });

  it("a versão sem nota (o juiz falhou) diz que não deu e continua com o roteiro e o botão; não leva o selo", () => {
    render(<VersoesTela {...PROPS} versoes={[versao(1, "Sem juiz", null), versao(2, "Com juiz", NOTAS(7, 7, 7))]} />);

    const semNota = folha("Versão 1 de 2: Sem juiz");
    expect(within(semNota).getByText(/Não deu para dar a nota desta versão agora/)).toBeTruthy();
    expect(within(semNota).queryByText("Nota mais alta")).toBeNull();
    expect(within(semNota).getByText("gancho de Sem juiz")).toBeTruthy();
    expect(within(semNota).getByRole("button", { name: /Ficar com esta/ })).toBeTruthy();
    // Ninguém tem a nota mais alta quando a primeira não tem nota (a ordem é a de escrita).
    expect(screen.queryByText("Nota mais alta")).toBeNull();
  });

  it("no Story e no vídeo sem fala não há 'o que você escolheu' nem 'Trocar o objetivo'", () => {
    render(<VersoesTela {...PROPS} escolheuOObjetivo={false} trocarObjetivoHref={null} />);

    expect(screen.queryByText("é o que você escolheu")).toBeNull();
    expect(screen.queryByRole("link", { name: "Trocar o objetivo" })).toBeNull();
    expect(screen.getByText("Ordenadas pela chance de te chamarem para comprar.")).toBeTruthy();
  });

  it("'Trocar o objetivo' leva ao objetivo do mesmo tema", () => {
    render(<VersoesTela {...PROPS} />);
    expect(screen.getByRole("link", { name: "Trocar o objetivo" }).getAttribute("href")).toBe("/criar/objetivo?tema=0");
  });

  it("a versão que já virou roteiro leva o selo 'Escolhida' e o link para o roteiro, não o botão", () => {
    render(<VersoesTela {...PROPS} versoes={[PROPS.versoes[0], versao(2, "A pergunta comum", NOTAS(9, 8.4, 7.1), { roteiroId: 77 })]} />);

    const escolhida = folha("Versão 2 de 2: A pergunta comum");
    expect(within(escolhida).getByText("Escolhida")).toBeTruthy();
    expect(within(escolhida).getByRole("link", { name: "Abrir o roteiro" }).getAttribute("href")).toBe("/roteiros/77");
    expect(within(escolhida).queryByRole("button", { name: /Ficar com esta/ })).toBeNull();
  });
});

describe("Ficar com esta", () => {
  it("chama a ação com o id da versão, mostra 'Abrindo o seu roteiro' e abre o roteiro", async () => {
    ficarComVersaoAction.mockResolvedValue({ ok: true, dado: { id: 321 } });
    render(<VersoesTela {...PROPS} />);

    fireEvent.click(within(folha("Versão 2 de 3")).getByRole("button", { name: /Ficar com esta/ }));

    await waitFor(() => expect(empurrar).toHaveBeenCalledWith("/roteiros/321"));
    expect(ficarComVersaoAction).toHaveBeenCalledWith(2);
    expect(screen.getByText("Abrindo o seu roteiro")).toBeTruthy();
  });

  it("a frase de erro do servidor aparece na folha em que a pessoa tocou, não no fim da página, e ela pode tentar de novo", async () => {
    ficarComVersaoAction.mockResolvedValue({ ok: false, erro: "Esta versão já está sendo escolhida. Tente de novo em instantes." });
    render(<VersoesTela {...PROPS} />);

    fireEvent.click(within(folha("Versão 2 de 3")).getByRole("button", { name: /Ficar com esta/ }));

    const frase = await screen.findByText("Esta versão já está sendo escolhida. Tente de novo em instantes.");
    expect(within(folha("Versão 2 de 3")).getByRole("alert")).toBe(frase);
    expect(empurrar).not.toHaveBeenCalled();
    expect((within(folha("Versão 2 de 3")).getByRole("button", { name: /Ficar com esta/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("o botão de cada folha diz de qual versão é (o nome acessível leva o nome da versão)", () => {
    render(<VersoesTela {...PROPS} />);
    expect(screen.getByRole("button", { name: "Ficar com esta: A pergunta comum" })).toBeTruthy();
  });
});

describe("Gerar outra", () => {
  it("a nova entra no fim, marcada Nova e aberta, sem reordenar as três, e o botão volta", async () => {
    gerarOutraVersaoAction.mockResolvedValue({ ok: true, dado: { versao: versao(4, "O antes e depois em dez segundos", NOTAS(8.9, 8.7, 7.4)) } });
    render(<VersoesTela {...PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Gerar outra" }));
    expect(screen.getByText("Escrevendo outra versão")).toBeTruthy();

    const quarta = await screen.findByRole("article", { name: /Versão 4 de 4: O antes e depois em dez segundos/ });
    expect(within(quarta).getByText("Nova")).toBeTruthy();
    expect(gerarOutraVersaoAction).toHaveBeenCalledWith(PROPS.grupo);
    // As três continuam nos mesmos lugares (agora "de 4"), e a nota mais alta não mudou de folha.
    const nomes = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(nomes).toEqual(["Demonstração direta", "A pergunta comum", "O custo de limpar duas vezes", "O antes e depois em dez segundos"]);
    expect(screen.getAllByText("Nota mais alta")).toHaveLength(1);
    expect(screen.queryByText("Escrevendo outra versão")).toBeNull();
    expect((screen.getByRole("button", { name: "Gerar outra" }) as HTMLButtonElement).disabled).toBe(false);
    // O leitor de tela é avisado de que a versão chegou ao fim da lista.
    expect(screen.getByText("A versão 4 ficou pronta e está no fim da lista.")).toBeTruthy();
  });

  it("enquanto escreve a nova, o 'Ficar com esta' das outras espera (as ações andam uma de cada vez)", async () => {
    let terminar: (valor: unknown) => void = () => undefined;
    gerarOutraVersaoAction.mockReturnValue(new Promise((resolve) => (terminar = resolve)));
    render(<VersoesTela {...PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Gerar outra" }));

    await screen.findByText("Escrevendo outra versão");
    for (const botao of screen.getAllByRole("button", { name: /Ficar com esta/ })) expect((botao as HTMLButtonElement).disabled).toBe(true);
    terminar({ ok: true, dado: { versao: versao(4, "A quarta", NOTAS(8, 8, 8)) } });
    await screen.findByRole("article", { name: /Versão 4 de 4/ });
    for (const botao of screen.getAllByRole("button", { name: /Ficar com esta/ })) expect((botao as HTMLButtonElement).disabled).toBe(false);
  });

  it("o erro volta como frase na tela e as versões que já havia continuam", async () => {
    gerarOutraVersaoAction.mockResolvedValue({ ok: false, erro: "Você chegou ao limite de versões de hoje. Amanhã a conta volta ao normal." });
    render(<VersoesTela {...PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Gerar outra" }));

    expect(await screen.findByText("Você chegou ao limite de versões de hoje. Amanhã a conta volta ao normal.")).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("uma resposta que se perde na rede não atualiza a tela sozinha (sem rede isso derruba o app): oferece 'Ver se ficou pronta'", async () => {
    gerarOutraVersaoAction.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<VersoesTela {...PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Gerar outra" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(atualizar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ver se ficou pronta" }));
    expect(atualizar).toHaveBeenCalledTimes(1);
  });
});
