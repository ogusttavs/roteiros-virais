/**
 * A fala marcada na tela (E41 parte 2b): as marcas são desenhos sem texto, então o texto que a pessoa lê tem de ser, letra por letra, o do roteiro (a trava, agora na tela), e cada
 * marca aparece com o nome que o leitor de tela lê.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { textosMarcasDeFala } from "@/textos/marcas-de-fala";

import { ComoLerAsMarcas } from "./ComoLerAsMarcas";
import { FalaMarcada } from "./FalaMarcada";
import { LinhaMarcasDeFala } from "./LinhaMarcasDeFala";
import { RoteiroTexto, type BlocoRoteiro } from "./RoteiroTexto";

afterEach(cleanup);

const MARCADO = "Se a mancha volta dois dias depois,{/} o problema não é o produto.{//} É a {p:ordem}.{v}{//} Você viu {d:R$ 49}?{^}{//}";
const ORIGINAL = "Se a mancha volta dois dias depois, o problema não é o produto. É a ordem. Você viu R$ 49?";

function dentroDeParagrafo(marcado: string) {
  return render(
    <p data-testid="fala">
      <FalaMarcada marcado={marcado} />
    </p>,
  );
}

vi.mock("@/ui/useFolhaNoHistorico", () => ({ useFolhaNoHistorico: (_aberta: boolean, aoFechar: () => void) => ({ fechar: aoFechar }) }));

describe("FalaMarcada", () => {
  it("o texto que se lê é o do roteiro, palavra por palavra e espaço por espaço", () => {
    dentroDeParagrafo(MARCADO);
    expect(screen.getByTestId("fala").textContent).toBe(ORIGINAL);
  });

  it("desenha cada marca com o nome que o leitor de tela lê", () => {
    dentroDeParagrafo(MARCADO);
    expect(screen.getAllByRole("img", { name: "pausa curta" })).toHaveLength(1);
    expect(screen.getAllByRole("img", { name: "pausa longa" })).toHaveLength(3);
    expect(screen.getAllByRole("img", { name: "tom desce" })).toHaveLength(1);
    expect(screen.getAllByRole("img", { name: "tom sobe" })).toHaveLength(1);
    // O peso é um <b> com a palavra; o devagar, o trecho inteiro.
    expect(screen.getByText("ordem").tagName).toBe("B");
    expect(screen.getByText("R$ 49").tagName).toBe("SPAN");
  });

  it("a pausa e o tom ficam com a palavra de antes numa caixa que não quebra, e o texto continua o mesmo", () => {
    dentroDeParagrafo("Você já passou por isso?{^}{//} Primeiro aplica.{//}");
    const palavra = screen.getByText("isso?");
    // A caixa tem só a última palavra e as marcas dela; o resto do texto fica solto para a linha quebrar onde quiser.
    expect(palavra.textContent).toBe("isso?");
    expect(palavra.querySelector('[aria-label="tom sobe"]')).not.toBeNull();
    expect(palavra.querySelector('[aria-label="pausa longa"]')).not.toBeNull();
    expect(screen.getByTestId("fala").textContent).toBe("Você já passou por isso? Primeiro aplica.");
  });

  it("um texto sem marcas sai igual", () => {
    dentroDeParagrafo("Só uma frase simples.");
    expect(screen.getByTestId("fala").textContent).toBe("Só uma frase simples.");
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("RoteiroTexto com as marcas", () => {
  const blocos: BlocoRoteiro[] = [
    { rotulo: "Os 3 primeiros segundos", paragrafos: ["Se a mancha volta, o problema é a ordem."], marcado: ["Se a mancha volta,{/} o problema é a {p:ordem}.{v}{//}"], tom: "direto" },
    { rotulo: "O meio", paragrafos: ["Primeiro aplica.", "Depois espera."], marcado: ["Primeiro {p:aplica}.{//}", "Depois espera.{//}"], tom: "calmo" },
  ];

  it("com as marcas ligadas, desenha a fala marcada e a linha do tom, sem mudar o texto", () => {
    const { container } = render(<RoteiroTexto blocos={blocos} comMarcas />);
    const falas = Array.from(container.querySelectorAll("p")).filter((p) => !p.hasAttribute("data-tom-do-bloco"));
    expect(falas.map((p) => p.textContent)).toEqual(["Se a mancha volta, o problema é a ordem.", "Primeiro aplica.", "Depois espera."]);
    expect(container.querySelector('[data-tom-do-bloco="direto"]')?.textContent).toContain("Tom: direto.");
    expect(container.querySelector('[data-tom-do-bloco="calmo"]')?.textContent).toContain(textosMarcasDeFala.tom.dica.calmo);
    expect(screen.getAllByRole("img", { name: "pausa longa" }).length).toBeGreaterThan(0);
  });

  it("desligadas, é o texto de sempre: nenhuma marca e nenhuma linha de tom", () => {
    const { container } = render(<RoteiroTexto blocos={blocos} comMarcas={false} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("[data-tom-do-bloco]")).toBeNull();
    expect(container.textContent).toContain("Se a mancha volta, o problema é a ordem.");
  });

  it("um bloco cujo marcado não tem o mesmo número de parágrafos fica como o texto de sempre", () => {
    const torto: BlocoRoteiro[] = [{ rotulo: "O meio", paragrafos: ["Um.", "Dois."], marcado: ["Um.{//} Dois.{//}"], tom: "perto" }];
    const { container } = render(<RoteiroTexto blocos={torto} comMarcas />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.textContent).toContain("Um.");
    expect(container.textContent).toContain("Dois.");
  });
});

describe("LinhaMarcasDeFala", () => {
  const base = { variante: "roteiro" as const, aoTrocar: () => {}, marcando: false, erro: null, avisos: [] };

  it("desligada, só mostra a chave; ligada, mostra também 'Como ler as marcas'", () => {
    const { rerender } = render(<LinhaMarcasDeFala {...base} ligadas={false} />);
    const chave = screen.getByRole("switch", { name: textosMarcasDeFala.chave });
    expect(chave.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("button", { name: textosMarcasDeFala.comoLer })).toBeNull();
    rerender(<LinhaMarcasDeFala {...base} ligadas />);
    expect(screen.getByRole("switch", { name: textosMarcasDeFala.chave }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: textosMarcasDeFala.comoLer })).toBeTruthy();
  });

  it("a chave pede o estado contrário", () => {
    const aoTrocar = vi.fn();
    render(<LinhaMarcasDeFala {...base} aoTrocar={aoTrocar} ligadas={false} />);
    fireEvent.click(screen.getByRole("switch", { name: textosMarcasDeFala.chave }));
    expect(aoTrocar).toHaveBeenCalledWith(true);
  });

  it("a espera só aparece com a chave ligada, e o erro só com a chave ligada", () => {
    const { rerender } = render(<LinhaMarcasDeFala {...base} ligadas={false} marcando erro="falhou" />);
    expect(screen.queryByText(textosMarcasDeFala.marcando)).toBeNull();
    rerender(<LinhaMarcasDeFala {...base} ligadas marcando erro={null} />);
    expect(screen.getByRole("status").textContent).toContain(textosMarcasDeFala.marcando);
    rerender(<LinhaMarcasDeFala {...base} ligadas marcando={false} erro="Não consegui marcar a fala agora." />);
    expect(screen.getByRole("alert").textContent).toBe("Não consegui marcar a fala agora.");
  });

  it("no modo gravação o botão é o curto", () => {
    render(<LinhaMarcasDeFala {...base} variante="gravacao" ligadas />);
    expect(screen.getByRole("button", { name: textosMarcasDeFala.comoLerCurto })).toBeTruthy();
  });
});

describe("ComoLerAsMarcas", () => {
  it("abre a folha com as seis marcas, o tom do bloco, a nota do rápido e a frase fixa da voz", () => {
    render(<ComoLerAsMarcas rotulo="Como ler as marcas" />);
    fireEvent.click(screen.getByRole("button", { name: "Como ler as marcas" }));
    const folha = screen.getByRole("dialog");
    for (const nome of ["Peso", "Pausa curta", "Pausa longa", "Devagar", "Tom desce", "Tom sobe", "O tom do bloco"]) {
      expect(folha.textContent).toContain(nome);
    }
    expect(folha.textContent).toContain(textosMarcasDeFala.legenda.notaRapido);
    expect(folha.textContent).toContain(textosMarcasDeFala.fraseDaVoz);
    // Nada de "Para este roteiro" sem avisos.
    expect(folha.textContent).not.toContain(textosMarcasDeFala.paraEsteRoteiro);
  });

  it("os avisos deste roteiro entram em texto de apoio, dentro da folha", () => {
    render(<ComoLerAsMarcas rotulo="Como ler" avisos={[{ regra: "R-FALA-01", texto: 'O vídeo começa com "Então". Entre direto na ideia.' }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Como ler" }));
    const folha = screen.getByRole("dialog");
    expect(folha.textContent).toContain(textosMarcasDeFala.paraEsteRoteiro);
    expect(folha.textContent).toContain('O vídeo começa com "Então".');
  });
});
