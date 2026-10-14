/**
 * O modo gravação do vídeo longo (E52, PR 5, passo 26): um capítulo por vez, "Já gravei este" marca e avança, a seta da direita passa sem marcar, o último capítulo troca a frase que segura
 * pela chamada final, o fim só aparece com todos marcados (e a seta do último volta ao primeiro que falta), a memória é do aparelho, e as marcas de fala só vão na frase dita como está escrita.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CapituloDoRoteiro } from "@/db/schema";
import type { FalaDoRoteiro } from "@/lib/marcas-de-fala";

const { marcarGravadoAction, marcarFalaAction, push } = vi.hoisted(() => ({ marcarGravadoAction: vi.fn(), marcarFalaAction: vi.fn(), push: vi.fn() }));
vi.mock("@/app/(painel)/(completo)/roteiros/[id]/acoes", () => ({ marcarGravadoAction, marcarFalaAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/ui/useSemRede", () => ({ useSemRede: () => false }));

import { GravacaoLongaTela } from "./GravacaoLongaTela";

const CAPITULOS: CapituloDoRoteiro[] = [
  { nome: "A mancha que volta", inicioS: 0, duracaoS: 60, tom: "direto", pontos: ["Mostre o sofá com a mancha de volta", "Conte o que você fez da primeira vez"], naImagem: "o sofá com a mancha", ganchoParaOProximo: "Fica até o fim que eu te mostro os erros.", comoEditar: "Corte a cada 5 segundos" },
  { nome: "Erro 1: esfregar antes do tempo", inicioS: 60, duracaoS: 90, tom: "calmo", pontos: ["Aplique e mostre o relógio", "Explique que esfregar espalha a sujeira"], naImagem: "o relógio na parede", ganchoParaOProximo: "E o erro 2 é o que quase todo mundo comete.", comoEditar: "Acelere a espera" },
  { nome: "O que fazer amanhã", inicioS: 150, duracaoS: 60, tom: "firme", pontos: ["Resuma os erros em uma frase cada", "Peça a mensagem com a foto da mancha"], naImagem: "você olhando para a câmera", ganchoParaOProximo: null, comoEditar: "Termine olhando para a câmera" },
];
const GANCHO = "Se a mancha volta dois dias depois, o problema não é o produto.";
const CHAMADA = "Me manda a foto da sua mancha que eu digo o que usar.";

const SEM_MARCAS: FalaDoRoteiro = { podeMarcar: false, somenteLeitura: false, marcas: null };

function montar(extra: Partial<React.ComponentProps<typeof GravacaoLongaTela>> = {}) {
  return render(<GravacaoLongaTela roteiroId={42} titulo="Os erros" capitulos={CAPITULOS} gancho={GANCHO} chamadaFinal={CHAMADA} jaGravado={false} fala={SEM_MARCAS} marcaId={7} {...extra} />);
}

const palco = () => document.querySelector("main") as HTMLElement;
const jaGravei = () => screen.getByRole("button", { name: /^Já gravei o capítulo/ });

beforeEach(() => {
  window.localStorage.clear();
  marcarGravadoAction.mockReset().mockResolvedValue(undefined);
  marcarFalaAction.mockReset();
  push.mockReset();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});
afterEach(cleanup);

describe("GravacaoLongaTela", () => {
  it("abre no primeiro capítulo: o tempo, o nome, os pontos numerados, o que está na imagem, o gancho do vídeo, a frase que segura e o que vem depois", async () => {
    montar();
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3 · 0:00 a 1:00"));
    expect(within(palco()).getByRole("heading", { name: "A mancha que volta" })).toBeTruthy();
    expect(within(palco()).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Mostre o sofá com a mancha de volta", "Conte o que você fez da primeira vez"]);
    expect(palco().querySelector("[data-na-imagem]")?.textContent).toContain("o sofá com a mancha");
    expect(palco().querySelector("[data-gancho-do-video]")?.textContent).toContain(GANCHO);
    expect(palco().querySelector("[data-segurar]")?.textContent).toContain("Fica até o fim que eu te mostro os erros.");
    expect(palco().textContent).toContain("Depois vem o capítulo 2, de 1:00 a 2:30");
    expect(palco().textContent).toContain("Erro 1: esfregar antes do tempo");
    expect(screen.getByText("1 de 3")).toBeTruthy();
    // o tom do capítulo, com a dica
    expect(palco().querySelector("[data-tom-do-capitulo]")?.textContent).toContain("Tom: direto.");
  });

  it("só o primeiro capítulo traz o gancho do vídeo; o do meio não", async () => {
    montar();
    await waitFor(() => expect(palco().querySelector("[data-gancho-do-video]")).not.toBeNull());
    fireEvent.click(jaGravei());
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 2 de 3"));
    expect(palco().querySelector("[data-gancho-do-video]")).toBeNull();
    expect(palco().querySelector("[data-segurar]")?.textContent).toContain("E o erro 2 é o que quase todo mundo comete.");
  });

  it("'Já gravei este' marca o capítulo neste aparelho e passa ao seguinte, sem tocar no servidor enquanto falta capítulo", async () => {
    montar();
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
    fireEvent.click(jaGravei());
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 2 de 3"));
    expect(document.querySelectorAll("[data-passo-gravado]")).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem("capitulos-gravados:42")!)).toEqual([0]);
    expect(marcarGravadoAction).not.toHaveBeenCalled();
  });

  it("a seta da direita passa sem marcar", async () => {
    montar();
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo capítulo, sem marcar" }));
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 2 de 3"));
    expect(document.querySelectorAll("[data-passo-gravado]")).toHaveLength(0);
    expect(window.localStorage.getItem("capitulos-gravados:42")).toBeNull();
  });

  it("a seta do anterior volta, e fica desabilitada no primeiro capítulo", async () => {
    montar();
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
    const anterior = screen.getByRole("button", { name: "Capítulo anterior" }) as HTMLButtonElement;
    expect(anterior.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Próximo capítulo, sem marcar" }));
    await waitFor(() => expect(anterior.disabled).toBe(false));
    fireEvent.click(anterior);
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
  });

  it("o último capítulo troca a frase que segura pela chamada final", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Próximo capítulo, sem marcar" }));
    fireEvent.click(screen.getByRole("button", { name: "Próximo capítulo, sem marcar" }));
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 3 de 3"));
    expect(palco().querySelector("[data-segurar]")).toBeNull();
    expect(palco().querySelector("[data-chamada-final]")?.textContent).toContain(CHAMADA);
    expect(palco().textContent).not.toContain("Depois vem");
  });

  it("com capítulo sem marcar, a seta no último volta ao primeiro que falta e o fim não aparece", async () => {
    montar();
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
    // marca o 1, passa o 2 sem marcar, marca o 3
    fireEvent.click(jaGravei());
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 2 de 3"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo capítulo, sem marcar" }));
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 3 de 3"));
    fireEvent.click(jaGravei());
    // o segundo ainda falta: volta a ele, em vez de mostrar o fim
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 2 de 3"));
    expect(document.querySelector("[data-gravacao-longa-fim]")).toBeNull();
    expect(marcarGravadoAction).not.toHaveBeenCalled();
    // e a seta da direita no último, sem marcar, também volta ao que falta
    fireEvent.click(screen.getByRole("button", { name: "Próximo capítulo, sem marcar" }));
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 3 de 3"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo capítulo, sem marcar" }));
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 2 de 3"));
  });

  it("com todos marcados aparece o fim, com a lista dos capítulos e o roteiro marcado como gravado uma vez", async () => {
    montar();
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
    fireEvent.click(jaGravei());
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 2 de 3"));
    fireEvent.click(jaGravei());
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 3 de 3"));
    fireEvent.click(jaGravei());
    const fim = await waitFor(() => {
      const el = document.querySelector("[data-gravacao-longa-fim]") as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    expect(fim.textContent).toContain("3 de 3 gravados");
    expect(within(fim).getByRole("heading", { name: "Os três capítulos estão gravados" })).toBeTruthy();
    expect(
      within(fim)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["0:00A mancha que volta", "1:00Erro 1: esfregar antes do tempo", "2:30O que fazer amanhã"]);
    expect(fim.textContent).toContain("confira depois de editar");
    await waitFor(() => expect(marcarGravadoAction).toHaveBeenCalledTimes(1));
    expect(marcarGravadoAction).toHaveBeenCalledWith(42);
    expect(screen.getByText("3 de 3")).toBeTruthy();
    // a seta da direita fica desabilitada no fim, e "Voltar ao roteiro" leva ao roteiro com o aviso de gravado
    expect((screen.getByRole("button", { name: "Próximo capítulo" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao roteiro" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/roteiros/42?gravado=1"));
  });

  it("o roteiro que já estava gravado não é marcado de novo no servidor", async () => {
    montar({ jaGravado: true });
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(jaGravei());
      await waitFor(() => expect(window.localStorage.getItem("capitulos-gravados:42")).toContain(String(i)));
    }
    await waitFor(() => expect(document.querySelector("[data-gravacao-longa-fim]")).not.toBeNull());
    expect(marcarGravadoAction).not.toHaveBeenCalled();
  });

  it("se o servidor falha ao marcar o roteiro, o aviso aparece, o fim continua e o que foi marcado no aparelho fica", async () => {
    marcarGravadoAction.mockRejectedValueOnce(new Error("caiu"));
    montar();
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(jaGravei());
      await waitFor(() => expect(window.localStorage.getItem("capitulos-gravados:42")).toContain(String(i)));
    }
    await waitFor(() => expect(document.querySelector("[data-gravacao-longa-fim]")).not.toBeNull());
    await waitFor(() => expect(screen.getByText(/Não deu para marcar agora|Sem conexão agora/)).toBeTruthy());
  });

  it("a memória do aparelho volta ao primeiro capítulo que falta, e com todos marcados volta ao fim", async () => {
    window.localStorage.setItem("capitulos-gravados:42", JSON.stringify([0, 1]));
    montar();
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 3 de 3"));
    cleanup();
    window.localStorage.setItem("capitulos-gravados:42", JSON.stringify([0, 1, 2]));
    montar();
    await waitFor(() => expect(document.querySelector("[data-gravacao-longa-fim]")).not.toBeNull());
    // lixo na memória (índice fora, não número, JSON quebrado) é ignorado, nunca erro
    cleanup();
    window.localStorage.setItem("capitulos-gravados:42", JSON.stringify([9, "a", -1, 1.5]));
    montar();
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
    // o índice fora da lista e o que não é número não viram capítulo gravado
    expect(document.querySelectorAll("[data-passo-gravado]")).toHaveLength(0);
    cleanup();
    window.localStorage.setItem("capitulos-gravados:42", "{não é json");
    montar();
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
  });

  it("do fim, a seta do anterior volta ao último capítulo", async () => {
    window.localStorage.setItem("capitulos-gravados:42", JSON.stringify([0, 1, 2]));
    montar();
    await waitFor(() => expect(document.querySelector("[data-gravacao-longa-fim]")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Capítulo anterior" }));
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 3 de 3"));
    expect(document.querySelector("[data-gravacao-longa-fim]")).toBeNull();
  });

  it("'Copiar os capítulos' no fim copia a lista da descrição", async () => {
    window.localStorage.setItem("capitulos-gravados:42", JSON.stringify([0, 1, 2]));
    montar();
    await waitFor(() => expect(document.querySelector("[data-gravacao-longa-fim]")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Copiar os capítulos" }));
    await waitFor(() => expect(screen.getByText("Capítulos copiados")).toBeTruthy());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(["00:00 A mancha que volta", "01:00 Erro 1: esfregar antes do tempo", "02:30 O que fazer amanhã"].join(String.fromCharCode(10)));
  });

  it("as marcas de fala vão só na frase dita como está escrita: o gancho do vídeo e a frase do capítulo as levam, os pontos nunca", async () => {
    const marcas = {
      blocos: [
        { bloco: "gancho" as const, marcado: "Se a mancha volta dois dias depois,{/} o problema não é o {p:produto}.{//}", tom: "direto" as const },
        { bloco: "corpo" as const, marcado: "Fica até o fim que eu te mostro os {p:erros}.{//}" + String.fromCharCode(10) + "E o erro 2 é o que quase todo mundo comete.{//}", tom: "perto" as const },
        { bloco: "chamadaFinal" as const, marcado: "Me manda a foto da sua mancha{/} que eu digo o que usar.{v}{//}", tom: "firme" as const },
      ],
      avisos: [],
    };
    montar({ fala: { podeMarcar: true, somenteLeitura: false, marcas } });
    await waitFor(() => expect(palco().querySelector("[data-gancho-do-video]")).not.toBeNull());
    // o texto que se lê é o do roteiro, letra por letra; as marcas são desenhadas entre as palavras
    expect(palco().querySelector("[data-gancho-do-video] p")?.textContent).toBe(GANCHO);
    expect(palco().querySelector("[data-gancho-do-video] [aria-label='pausa curta']")).not.toBeNull();
    expect(palco().querySelector("[data-segurar] [aria-label='pausa longa']")).not.toBeNull();
    // os pontos ficam como estão, sem nenhuma marca
    expect(palco().querySelector("ol [aria-label='pausa curta']")).toBeNull();
    expect(palco().querySelector("ol b")).toBeNull();
  });

  it("a marca da frase de um capítulo vai no capítulo certo mesmo quando o anterior não tem frase (a ordem é a das frases, não a dos capítulos)", async () => {
    const semGanchoNoPrimeiro = CAPITULOS.map((c, i) => (i === 0 ? { ...c, ganchoParaOProximo: null } : c));
    const marcas = {
      blocos: [{ bloco: "corpo" as const, marcado: "E o erro 2 é o que quase todo mundo comete.{//}", tom: "perto" as const }],
      avisos: [],
    };
    montar({ capitulos: semGanchoNoPrimeiro, fala: { podeMarcar: true, somenteLeitura: false, marcas } });
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
    // o primeiro capítulo não tem frase: nada para marcar nele
    expect(palco().querySelector("[data-segurar]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Próximo capítulo, sem marcar" }));
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 2 de 3"));
    expect(palco().querySelector("[data-segurar] p")?.textContent).toBe("E o erro 2 é o que quase todo mundo comete.");
    expect(palco().querySelector("[data-segurar] [aria-label='pausa longa']")).not.toBeNull();
  });

  it("marca de outro texto (que não bate com o roteiro) não é desenhada: a frase volta como está", async () => {
    const marcas = { blocos: [{ bloco: "gancho" as const, marcado: "Outra frase completamente diferente.{//}", tom: "direto" as const }], avisos: [] };
    montar({ fala: { podeMarcar: true, somenteLeitura: false, marcas } });
    await waitFor(() => expect(palco().querySelector("[data-gancho-do-video]")).not.toBeNull());
    expect(palco().querySelector("[data-gancho-do-video] p")?.textContent).toBe(GANCHO);
    expect(palco().querySelector("[data-gancho-do-video] [aria-label]")).toBeNull();
  });

  it("sem fala para marcar não há a chave das marcas", async () => {
    montar();
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
    expect(screen.queryByText("Marcas de fala")).toBeNull();
  });

  it("não derruba a tela quando os capítulos têm tom fora da lista: só não mostra o tom", async () => {
    montar({ capitulos: CAPITULOS.map((c) => ({ ...c, tom: "teatral" })) });
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
    expect(palco().querySelector("[data-tom-do-capitulo]")).toBeNull();
  });

  it("o que a tela não deixa passar: ninguém marca sozinho no servidor antes de todos os capítulos", async () => {
    montar();
    await waitFor(() => expect(palco().textContent).toContain("Capítulo 1 de 3"));
    await act(async () => {
      fireEvent.click(jaGravei());
    });
    expect(marcarGravadoAction).not.toHaveBeenCalled();
  });
});
