/** "O que o público pergunta" (E28, passo 25): a lista com o botão em cada linha e o bloco com a frase da leitura. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BlocoDePerguntas, ListaDePerguntas } from "./PerguntasDoPublico";

afterEach(cleanup);

const PERGUNTAS = [
  { chave: "aaaaaaaaaaaa", texto: "Serve em tecido de camurça?", vezesTexto: "perguntado 14 vezes" },
  { chave: "bbbbbbbbbbbb", texto: "A mancha voltou depois de secar", vezesTexto: "reclamado 7 vezes" },
];

describe("ListaDePerguntas", () => {
  it("escreve a pergunta, as vezes e um botão com o nome da pergunta em cada linha", () => {
    render(<ListaDePerguntas perguntas={PERGUNTAS} rotuloDoBotao="Responder em vídeo" nomeDoBotao={(t) => `Responder em vídeo: ${t}`} aoResponder={() => {}} />);
    expect(screen.getByText("Serve em tecido de camurça?")).toBeTruthy();
    expect(screen.getByText("perguntado 14 vezes")).toBeTruthy();
    expect(screen.getByText("reclamado 7 vezes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Responder em vídeo: Serve em tecido de camurça?" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("o toque devolve a chave da pergunta, nunca o texto", () => {
    const aoResponder = vi.fn();
    render(<ListaDePerguntas perguntas={PERGUNTAS} rotuloDoBotao="Responder" nomeDoBotao={(t) => `Responder: ${t}`} aoResponder={aoResponder} />);
    fireEvent.click(screen.getByRole("button", { name: "Responder: A mancha voltou depois de secar" }));
    expect(aoResponder).toHaveBeenCalledWith("bbbbbbbbbbbb");
  });

  it("a que está abrindo diz 'Abrindo' e as outras ficam paradas", () => {
    render(
      <ListaDePerguntas
        perguntas={PERGUNTAS}
        rotuloDoBotao="Responder"
        nomeDoBotao={(t) => `Responder: ${t}`}
        aoResponder={() => {}}
        abrindo="aaaaaaaaaaaa"
        desabilitado
        textoAbrindo="Abrindo"
      />,
    );
    const abrindo = screen.getByRole("button", { name: "Responder: Serve em tecido de camurça?" });
    expect(abrindo.textContent).toContain("Abrindo");
    expect(abrindo.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Responder: A mancha voltou depois de secar" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("BlocoDePerguntas", () => {
  it("tem o rótulo, o título como título da seção, a lista e a frase da leitura com o que foi lido", () => {
    render(
      <BlocoDePerguntas
        id="t-teste"
        rotulo="Nos comentários do seu setor"
        titulo="O que o público pergunta"
        leitura="Dos comentários dos 12 vídeos mais vistos do seu setor no YouTube, lidos em 11 de outubro. É a nossa leitura: ninguém é citado pelo nome."
        perguntas={PERGUNTAS}
        rotuloDoBotao="Responder em vídeo"
        nomeDoBotao={(t) => `Responder em vídeo: ${t}`}
        aoResponder={() => {}}
      />,
    );
    const secao = screen.getByRole("region", { name: "O que o público pergunta" });
    expect(secao.getAttribute("data-perguntas-do-publico")).not.toBeNull();
    expect(screen.getByText("Nos comentários do seu setor")).toBeTruthy();
    expect(screen.getByText(/lidos em 11 de outubro/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "O que o público pergunta", level: 3 })).toBeTruthy();
  });

  it("nas Referências o título é de nível 2 e a ação do topo (Recolher) aparece", () => {
    const recolher = vi.fn();
    render(
      <BlocoDePerguntas
        id="t-ref"
        nivelDoTitulo={2}
        rotulo="Nos comentários do seu setor"
        titulo="O que o público pergunta"
        leitura="frase"
        acao={<button onClick={recolher}>Recolher</button>}
        perguntas={PERGUNTAS}
        rotuloDoBotao="Responder em vídeo"
        nomeDoBotao={(t) => t}
        aoResponder={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "O que o público pergunta", level: 2 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recolher" }));
    expect(recolher).toHaveBeenCalled();
  });
});
