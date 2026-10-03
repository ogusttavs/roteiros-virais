/**
 * A busca instantânea de ramo (E45, PR 1): o que o e2e não alcança com precisão (o que o leitor de tela ouve, para onde o foco e a
 * opção destacada vão a cada tecla, o que o Enter faz com um formulário em volta). Posição, 44 pontos e rolagem dependem de layout,
 * que o jsdom não tem: ficam para o e2e.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BuscaDeRamo } from "./BuscaDeRamo";

afterEach(cleanup);

const NAO_ACHEI = "Não achei o meu";

function Exemplo(props: {
  valorInicial?: string | null;
  nomeForaDoCatalogo?: string | null;
  onEscolher?: (slug: string) => void;
  onNaoAchei?: (texto: string) => void;
  erro?: string;
}) {
  const [valor, setValor] = useState<string | null>(props.valorInicial ?? null);
  return (
    <BuscaDeRamo
      rotulo="Ramo"
      ajuda="Escreva uma palavra ou uma letra."
      erro={props.erro}
      valor={valor}
      nomeForaDoCatalogo={props.nomeForaDoCatalogo}
      textoNaoAchei={NAO_ACHEI}
      onEscolher={(slug) => {
        setValor(slug);
        props.onEscolher?.(slug);
      }}
      onNaoAchei={(texto) => {
        setValor(null);
        props.onNaoAchei?.(texto);
      }}
    />
  );
}

function campoDeBusca(): HTMLInputElement {
  return screen.getByRole("combobox", { name: "Ramo" }) as HTMLInputElement;
}

function digitar(texto: string) {
  fireEvent.focus(campoDeBusca());
  fireEvent.change(campoDeBusca(), { target: { value: texto } });
}

function opcaoAtiva(): string | null {
  const id = campoDeBusca().getAttribute("aria-activedescendant");
  return id ? (document.getElementById(id)?.textContent ?? null) : null;
}

describe("BuscaDeRamo", () => {
  it("é um combobox com rótulo; fechado no começo, e ao receber o foco abre a lista com o catálogo inteiro, em grupos", () => {
    render(<Exemplo />);
    const campo = campoDeBusca();
    expect(campo.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.focus(campo);

    expect(campo.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox", { name: "Ramos" })).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(44);
    expect(screen.getAllByRole("group")).toHaveLength(9);
    // Sem digitar, não há "Não achei o meu" (a pessoa ainda nem procurou).
    expect(screen.queryByText(NAO_ACHEI)).toBeNull();
  });

  it("a palavra 'dentista' põe Odontologia em primeiro, destacada, e o leitor de tela ouve quantos ramos achou", () => {
    render(<Exemplo />);
    digitar("dentista");

    const opcoes = screen.getAllByRole("option");
    expect(opcoes[0].textContent).toContain("Odontologia");
    expect(opcoes[0].getAttribute("aria-selected")).toBe("true");
    expect(campoDeBusca().getAttribute("aria-activedescendant")).toBe(opcoes[0].id);
    expect(screen.getByRole("status").textContent).toBe("1 ramo encontrado.");
  });

  it("o Enter escolhe o primeiro resultado, fecha a lista, mostra o nome no campo e NÃO envia o formulário em volta", () => {
    const aoEscolher = vi.fn();
    const aoEnviar = vi.fn((evento: { preventDefault: () => void }) => evento.preventDefault());
    render(
      <form onSubmit={aoEnviar}>
        <Exemplo onEscolher={aoEscolher} />
      </form>,
    );
    digitar("piloto");

    const naoCancelado = fireEvent.keyDown(campoDeBusca(), { key: "Enter" });

    expect(naoCancelado).toBe(false);
    expect(aoEscolher).toHaveBeenCalledWith("automobilismo-e-pilotagem");
    expect(campoDeBusca().value).toBe("Automobilismo e pilotagem");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Automobilismo e pilotagem escolhido.");
    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it("com a lista fechada o Enter é do formulário (não é interceptado)", () => {
    render(<Exemplo valorInicial="odontologia" />);
    const naoCancelado = fireEvent.keyDown(campoDeBusca(), { key: "Enter" });
    expect(naoCancelado).toBe(true);
  });

  it("as setas andam pelas opções, com volta no fim e no começo, e o campo continua com o foco", () => {
    render(<Exemplo />);
    digitar("est");
    const opcoes = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    const primeira = opcaoAtiva();
    expect(primeira).toBe(opcoes[0]);

    fireEvent.keyDown(campoDeBusca(), { key: "ArrowDown" });
    expect(opcaoAtiva()).toBe(opcoes[1]);

    fireEvent.keyDown(campoDeBusca(), { key: "ArrowUp" });
    fireEvent.keyDown(campoDeBusca(), { key: "ArrowUp" });
    // Subir do primeiro vai à última (o "Não achei o meu", que aparece quando há texto).
    expect(opcaoAtiva()).toContain(NAO_ACHEI);

    fireEvent.keyDown(campoDeBusca(), { key: "ArrowDown" });
    expect(opcaoAtiva()).toBe(opcoes[0]);
  });

  it("a seta para baixo com a lista fechada abre a lista", () => {
    render(<Exemplo valorInicial="odontologia" />);
    fireEvent.keyDown(campoDeBusca(), { key: "ArrowDown" });
    expect(campoDeBusca().getAttribute("aria-expanded")).toBe("true");
  });

  it("o Esc fecha só a lista (não sobe para a folha ou a tela) e o campo volta ao ramo escolhido", () => {
    const aoTeclarFora = vi.fn();
    render(
      <div onKeyDown={aoTeclarFora}>
        <Exemplo valorInicial="odontologia" />
      </div>,
    );
    digitar("xyz");
    expect(campoDeBusca().getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(campoDeBusca(), { key: "Escape" });

    expect(campoDeBusca().getAttribute("aria-expanded")).toBe("false");
    expect(campoDeBusca().value).toBe("Odontologia");
    expect(aoTeclarFora).not.toHaveBeenCalled();
  });

  it("o Esc com a lista fechada não faz nada (deixa o Esc seguir para quem fecha a folha)", () => {
    const aoTeclarFora = vi.fn();
    render(
      <div onKeyDown={aoTeclarFora}>
        <Exemplo />
      </div>,
    );
    fireEvent.keyDown(campoDeBusca(), { key: "Escape" });
    expect(aoTeclarFora).toHaveBeenCalledTimes(1);
  });

  it("sem resultado: diz o que a pessoa digitou, e a única saída é o 'Não achei o meu', que o Enter escolhe com o texto digitado", () => {
    const aoNaoAchar = vi.fn();
    render(<Exemplo onNaoAchei={aoNaoAchar} />);
    digitar("xyzw");

    expect(screen.getByText("Nenhum ramo começa com “xyzw”.")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(opcaoAtiva()).toContain(NAO_ACHEI);
    expect(screen.getByRole("status").textContent).toBe("Nenhum ramo encontrado.");

    fireEvent.keyDown(campoDeBusca(), { key: "Enter" });

    expect(aoNaoAchar).toHaveBeenCalledWith("xyzw");
    expect(campoDeBusca().value).toBe(NAO_ACHEI);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("com resultados e texto, o 'Não achei o meu' também está na lista, por último", () => {
    render(<Exemplo />);
    digitar("loja");
    const opcoes = screen.getAllByRole("option");
    expect(opcoes.length).toBeGreaterThan(1);
    expect(opcoes[opcoes.length - 1].textContent).toContain(NAO_ACHEI);
  });

  it("o clique numa opção escolhe, e o mousedown nas opções não tira o foco do campo", () => {
    const aoEscolher = vi.fn();
    render(<Exemplo onEscolher={aoEscolher} />);
    fireEvent.focus(campoDeBusca());
    const opcao = screen.getAllByRole("option").find((o) => o.textContent?.includes("Nutrição"))!;

    const naoCancelado = fireEvent.mouseDown(opcao);
    fireEvent.click(opcao);

    expect(naoCancelado).toBe(false);
    expect(aoEscolher).toHaveBeenCalledWith("nutricao");
    expect(campoDeBusca().value).toBe("Nutrição");
  });

  it("sem acento e sem maiúscula: 'ESTETICA' acha as duas Estéticas, e uma letra já acha ramos", () => {
    render(<Exemplo />);
    digitar("ESTETICA");
    const nomes = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(nomes.some((n) => n.includes("Estética automotiva"))).toBe(true);
    expect(nomes.some((n) => n.includes("Estética e pele"))).toBe(true);

    fireEvent.change(campoDeBusca(), { target: { value: "d" } });
    expect(screen.getAllByRole("option").length).toBeGreaterThan(10);
  });

  it("perder o foco fecha a lista e devolve ao campo o ramo escolhido (o que foi digitado e não escolhido some)", () => {
    render(<Exemplo valorInicial="nutricao" />);
    digitar("xyz");
    expect(campoDeBusca().value).toBe("xyz");

    fireEvent.blur(campoDeBusca());

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(campoDeBusca().value).toBe("Nutrição");
  });

  it("mostra o ramo que a marca já tem: o do catálogo pelo nome dele, e um setor feito à mão pelo nome que a tela passou", () => {
    const { unmount } = render(<Exemplo valorInicial="odontologia" />);
    expect(campoDeBusca().value).toBe("Odontologia");
    unmount();

    render(<Exemplo nomeForaDoCatalogo="Empreendedorismo e Construção de Marcas" />);
    expect(campoDeBusca().value).toBe("Empreendedorismo e Construção de Marcas");
  });

  it("marca, para o leitor de tela, qual opção é o ramo de hoje", () => {
    render(<Exemplo valorInicial="nutricao" />);
    fireEvent.focus(campoDeBusca());
    const atual = screen.getAllByRole("option").find((o) => o.textContent?.includes("Nutrição"))!;
    expect(atual.textContent).toContain("o ramo de hoje");
    expect(screen.getAllByText("o ramo de hoje")).toHaveLength(1);
    // Ao abrir sem digitar, a opção destacada é a do ramo de hoje.
    expect(campoDeBusca().getAttribute("aria-activedescendant")).toBe(atual.id);
  });

  it("o erro aparece embaixo, como alerta, e o campo se declara inválido e ligado a ele", () => {
    render(<Exemplo erro="Escolha o seu ramo" />);
    expect(screen.getByRole("alert").textContent).toBe("Escolha o seu ramo");
    expect(campoDeBusca().getAttribute("aria-invalid")).toBe("true");
    expect(campoDeBusca().getAttribute("aria-describedby")).toContain(screen.getByRole("alert").id);
  });

  it("o nome do campo é o rótulo e a dica fica ligada a ele (leitor de tela)", () => {
    render(<Exemplo />);
    const ligadas = campoDeBusca().getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(ligadas.split(" ")[0])?.textContent).toBe("Escreva uma palavra ou uma letra.");
  });
});
