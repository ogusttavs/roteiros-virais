/**
 * O roteiro longo na tela (E52, PR 4b): o índice com os tempos a partir de `iniciosDosCapitulos`, o cartão do primeiro capítulo (traz o gancho do vídeo), do meio (o que segura até o
 * próximo) e do último (a chamada, sem gancho para o próximo), o "Copiar os capítulos" e a edição de um capítulo por vez.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConteudoRoteiro } from "@/db/schema";
import { capitulosParaCopiar } from "@/lib/capitulos-do-roteiro";

import { RoteiroLongo } from "./RoteiroLongo";

const QUEBRA = String.fromCharCode(10);

const capitulos = [
  { nome: "A mancha que volta", inicioS: 0, duracaoS: 50, tom: "direto", pontos: ["Mostre o sofá", "Conte o que fez"], naImagem: "o sofá com a mancha", ganchoParaOProximo: "Fica até o fim que eu te mostro os erros", comoEditar: "Corte a cada 5 segundos" },
  { nome: "Erro 1: esfregar antes", inicioS: 50, duracaoS: 110, tom: "calmo", pontos: ["Aplique", "Espere o tempo do rótulo"], naImagem: "o relógio", ganchoParaOProximo: "E o erro 2 é o que quase todo mundo comete", comoEditar: "Acelere a espera" },
  { nome: "O que fazer amanhã", inicioS: 160, duracaoS: 50, tom: "firme", pontos: ["Resuma os erros", "Peça a mensagem"], naImagem: "você olhando para a câmera", ganchoParaOProximo: null, comoEditar: "Termine olhando para a câmera" },
];

const corpo = {
  titulo: "Os erros que fazem a mancha voltar",
  duracaoS: 210,
  gancho: "Se a mancha volta dois dias depois, o problema não é o produto.",
  chamadaFinal: "Manda a foto da sua mancha que eu digo o que usar.",
  capitulos,
} as unknown as ConteudoRoteiro;

function montar(extra: Partial<React.ComponentProps<typeof RoteiroLongo>> = {}) {
  const salvar = vi.fn().mockResolvedValue(null);
  render(<RoteiroLongo corpo={corpo} somenteLeitura={false} semConexao={false} salvar={salvar} {...extra} />);
  return { salvar };
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});
afterEach(cleanup);

describe("RoteiroLongo", () => {
  it("o índice lista o tempo de início e o nome de cada capítulo, o primeiro em 0:00 e os outros somando as durações", () => {
    montar();
    const indice = screen.getByRole("region", { name: "Os capítulos" });
    const itens = within(indice)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(itens).toEqual(["0:00A mancha que volta", "0:50Erro 1: esfregar antes", "2:40O que fazer amanhã"]);
  });

  it("o cartão do primeiro capítulo traz o gancho do vídeo e o que segura até o próximo; o do meio, só o que segura; o do último, a chamada e nenhum gancho", () => {
    montar();
    const primeiro = screen.getByRole("region", { name: "A mancha que volta" });
    expect(primeiro.textContent).toContain("Capítulo 1 · 0:00 a 0:50");
    expect(within(primeiro).getByText("O gancho do vídeo")).toBeTruthy();
    expect(within(primeiro).getByText("Se a mancha volta dois dias depois, o problema não é o produto.")).toBeTruthy();
    expect(within(primeiro).getByText("Para segurar até o próximo")).toBeTruthy();

    const meio = screen.getByRole("region", { name: "Erro 1: esfregar antes" });
    expect(meio.textContent).toContain("Capítulo 2 · 0:50 a 2:40");
    expect(within(meio).queryByText("O gancho do vídeo")).toBeNull();
    expect(within(meio).getByText("E o erro 2 é o que quase todo mundo comete")).toBeTruthy();
    expect(
      within(meio)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Aplique", "Espere o tempo do rótulo"]);
    expect(within(meio).getByText("Como editar este capítulo")).toBeTruthy();

    const ultimo = screen.getByRole("region", { name: "O que fazer amanhã" });
    expect(ultimo.textContent).toContain("Capítulo 3 · 2:40 a 3:30");
    expect(within(ultimo).queryByText("Para segurar até o próximo")).toBeNull();
    expect(within(ultimo).getByText("A chamada final")).toBeTruthy();
    expect(within(ultimo).getByText("Manda a foto da sua mancha que eu digo o que usar.")).toBeTruthy();
  });

  it("'Copiar os capítulos' põe na área de transferência a lista da descrição e diz que copiou", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Copiar os capítulos" }));
    await waitFor(() => expect(screen.getByText("Capítulos copiados")).toBeTruthy());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(capitulosParaCopiar(capitulos));
    expect(capitulosParaCopiar(capitulos)).toBe(["00:00 A mancha que volta", "00:50 Erro 1: esfregar antes", "02:40 O que fazer amanhã"].join(QUEBRA));
  });

  it("se a cópia falha, a frase diz para copiar à mão e nada diz que copiou", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("negado")) }, configurable: true });
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Copiar os capítulos" }));
    await waitFor(() => expect(screen.getByText(/Não deu para copiar os capítulos/)).toBeTruthy());
    expect(screen.queryByText("Capítulos copiados")).toBeNull();
  });

  it("editar um capítulo abre só os campos dele e salva o gancho, os pontos (um por linha, sem linhas vazias) e o índice certo", async () => {
    const { salvar } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Editar o capítulo Erro 1: esfregar antes" }));
    // com um capítulo aberto, os botões dos outros somem: um por vez
    expect(screen.queryAllByRole("button", { name: /^Editar o capítulo/ })).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Para segurar até o próximo"), { target: { value: "E o erro seguinte pega todo mundo" } });
    fireEvent.change(screen.getByLabelText("O que falar (um ponto por linha)"), { target: { value: ["Aplique agora", "", "Espere cinco minutos", "  "].join(QUEBRA) } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar o capítulo" }));
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
    expect(salvar).toHaveBeenCalledWith(1, { pontos: ["Aplique agora", "Espere cinco minutos"], ganchoParaOProximo: "E o erro seguinte pega todo mundo" });
    // salvou: o cartão volta a ser lido e os botões de editar voltam
    await waitFor(() => expect(screen.queryByRole("button", { name: "Salvar o capítulo" })).toBeNull());
    expect(screen.getAllByRole("button", { name: /^Editar o capítulo/ })).toHaveLength(3);
  });

  it("o primeiro capítulo manda também o gancho do vídeo e o último manda a chamada (nunca o gancho para o próximo)", async () => {
    const { salvar } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Editar o capítulo A mancha que volta" }));
    fireEvent.change(screen.getByLabelText("O gancho do vídeo"), { target: { value: "Um gancho novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar o capítulo" }));
    await waitFor(() => expect(salvar).toHaveBeenCalledWith(0, expect.objectContaining({ gancho: "Um gancho novo", ganchoParaOProximo: capitulos[0].ganchoParaOProximo })));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Salvar o capítulo" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Editar o capítulo O que fazer amanhã" }));
    expect(screen.queryByLabelText("Para segurar até o próximo")).toBeNull();
    fireEvent.change(screen.getByLabelText("A chamada final"), { target: { value: "Chame no direct" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar o capítulo" }));
    await waitFor(() => expect(salvar).toHaveBeenLastCalledWith(2, { pontos: capitulos[2].pontos, chamadaFinal: "Chame no direct" }));
  });

  it("quando o servidor recusa, a frase aparece dentro do cartão, o que a pessoa escreveu continua lá e o cartão fica aberto", async () => {
    const salvar = vi.fn().mockResolvedValue("Não conseguimos salvar agora.");
    montar({ salvar });
    fireEvent.click(screen.getByRole("button", { name: "Editar o capítulo A mancha que volta" }));
    fireEvent.change(screen.getByLabelText("O que falar (um ponto por linha)"), { target: { value: "Meu texto" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar o capítulo" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Não conseguimos salvar agora."));
    expect((screen.getByLabelText("O que falar (um ponto por linha)") as HTMLTextAreaElement).value).toBe("Meu texto");
  });

  it("sem nenhum ponto sobrando a tela diz a frase e nada vai ao servidor", () => {
    const { salvar } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Editar o capítulo A mancha que volta" }));
    fireEvent.change(screen.getByLabelText("O que falar (um ponto por linha)"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar o capítulo" }));
    expect(screen.getByRole("alert").textContent).toContain("Deixe de 1 a 8 pontos");
    expect(salvar).not.toHaveBeenCalled();
  });

  it("as marcas de fala vão só nas frases ditas como estão escritas, no capítulo certo, e nunca nos pontos", () => {
    const semGanchoNoPrimeiro = { ...corpo, capitulos: capitulos.map((c, i) => (i === 0 ? { ...c, ganchoParaOProximo: null } : c)) } as unknown as ConteudoRoteiro;
    const marcas = {
      blocos: [
        { bloco: "gancho" as const, marcado: "Se a mancha volta dois dias depois,{/} o problema não é o produto.{//}", tom: "direto" as const },
        { bloco: "corpo" as const, marcado: "E o erro 2 é o que quase todo mundo{/} comete{//}", tom: "perto" as const },
        { bloco: "chamadaFinal" as const, marcado: "Manda a foto da sua mancha{/} que eu digo o que usar.{v}{//}", tom: "firme" as const },
      ],
      avisos: [],
    };
    montar({ corpo: semGanchoNoPrimeiro, marcas });
    const primeiro = screen.getByRole("region", { name: "A mancha que volta" });
    const segundo = screen.getByRole("region", { name: "Erro 1: esfregar antes" });
    const ultimo = screen.getByRole("region", { name: "O que fazer amanhã" });
    // o gancho do vídeo (primeiro capítulo) e a chamada (último) levam as suas marcas; o texto que se lê é o do roteiro
    expect(primeiro.querySelector("[aria-label='pausa curta']")).not.toBeNull();
    expect(ultimo.querySelector("[aria-label='pausa curta']")).not.toBeNull();
    // a frase do segundo capítulo leva a marca dela (a primeira frase do bloco, mesmo com o primeiro capítulo sem frase)
    expect(segundo.querySelector("dd [aria-label='pausa curta']")).not.toBeNull();
    expect(segundo.textContent).toContain("E o erro 2 é o que quase todo mundo comete");
    // os pontos nunca
    for (const lista of document.querySelectorAll("ul")) expect(lista.querySelector("[aria-label]")).toBeNull();
  });

  it("marca que não bate com o texto do roteiro não é desenhada", () => {
    const marcas = { blocos: [{ bloco: "gancho" as const, marcado: "Outro texto qualquer.{//}", tom: "direto" as const }], avisos: [] };
    montar({ marcas });
    expect(screen.getByRole("region", { name: "A mancha que volta" }).querySelector("[aria-label='pausa longa']")).toBeNull();
  });

  it("'Cancelar' fecha o cartão sem salvar", () => {
    const { salvar } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Editar o capítulo A mancha que volta" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(salvar).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Salvar o capítulo" })).toBeNull();
  });

  it("no 'ver como' não há botão de editar, e sem conexão o salvar fica desabilitado", () => {
    montar({ somenteLeitura: true });
    expect(screen.queryAllByRole("button", { name: /^Editar o capítulo/ })).toHaveLength(0);
    cleanup();
    montar({ semConexao: true });
    fireEvent.click(screen.getByRole("button", { name: "Editar o capítulo A mancha que volta" }));
    expect((screen.getByRole("button", { name: "Salvar o capítulo" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
