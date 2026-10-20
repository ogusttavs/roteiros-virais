/** O "Por quê" de cada bloco (E50 parte 2, PR 4; passo 24): fechado é só a palavra, aberto traz "O que faz", "Com base em" e "Para"; "Ver os porquês" abre todos; roteiro antigo não mostra a palavra. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Type } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";

import { REGRAS_COPY_ROTEIRO } from "@/ia/prompts/regras-copy-roteiro";
import type { PorQueDoBloco } from "@/lib/por-que-do-bloco";


import { BlocoEdicao } from "./BlocoEdicao";
import { enderecoNoSegundo, PorQueAberto, PorQueBotao, PorQuesProvider, VerOsPorques } from "./PorQue";

afterEach(cleanup);

const frase = (n: string) => REGRAS_COPY_ROTEIRO.find((r) => r.numero === n)!.porQue;

const ITENS: PorQueDoBloco[] = [
  { bloco: "gancho", regras: ["R-COPY-05"], video: { videoId: 7, segundo: 83 }, para: "fiquem" },
  { bloco: "corpo", regras: ["R-COPY-13", "R-COPY-12", "R-COPY-01"], para: "confiem" },
  { bloco: "tela:0", regras: ["R-COPY-12"] },
  { bloco: "tela:1", regras: ["R-COPY-01"] },
];

function Tela({ itens = ITENS }: { itens?: PorQueDoBloco[] | undefined }) {
  return (
    <PorQuesProvider itens={itens} videos={{ 7: { url: "https://exemplo.test/v/7", conta: "@limpeza_da_casa", vezes: 4.1 } }}>
      <VerOsPorques />
      <section>
        <PorQueBotao chaves={["gancho"]} id="pq-gancho" rotuloDoBloco="Abertura" />
        <PorQueAberto chaves={["gancho"]} id="pq-gancho" />
      </section>
      <section>
        <PorQueBotao chaves={["corpo"]} id="pq-corpo" rotuloDoBloco="Meio" />
        <PorQueAberto chaves={["corpo"]} id="pq-corpo" />
      </section>
      <section>
        <PorQueBotao chaves={["fechamento"]} id="pq-fechamento" rotuloDoBloco="Fechamento" />
        <PorQueAberto chaves={["fechamento"]} id="pq-fechamento" />
      </section>
      <section>
        <PorQueBotao chaves={["tela:0", "tela:1"]} id="pq-telas" rotuloDoBloco="Texto na tela" />
        <PorQueAberto chaves={["tela:0", "tela:1"]} id="pq-telas" />
      </section>
    </PorQuesProvider>
  );
}

describe("PorQue", () => {
  it("fechado: só a palavra, em cada bloco que tem por quê, e nada no que não tem", () => {
    render(<Tela />);
    expect(screen.getByRole("button", { name: "Por quê: Abertura" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Por quê: Meio" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Por quê: Fechamento" })).toBeNull();
    expect(screen.queryByText("O que faz:")).toBeNull();
  });

  it("abrir mostra o que faz, com base em (o vídeo, com o link no segundo) e para; fechar de novo esconde", () => {
    render(<Tela />);
    const botao = screen.getByRole("button", { name: "Por quê: Abertura" });
    fireEvent.click(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(frase("R-COPY-05"), { exact: false })).toBeTruthy();
    expect(screen.getByText("O vídeo de @limpeza_da_casa, 4,1x acima do normal da conta.")).toBeTruthy();
    // fora do YouTube o link abre o vídeo e o texto não promete o segundo
    const link = screen.getByRole("link", { name: "Ver o vídeo" });
    expect(link.getAttribute("href")).toBe("https://exemplo.test/v/7");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("Que a pessoa fique até o fim.", { exact: false })).toBeTruthy();
    fireEvent.click(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("O que faz:")).toBeNull();
  });

  it("sem vídeo, 'Com base em' diz o tipo de regra em português, nunca o código; 'O que faz' junta no máximo duas frases, a primeira regra primeiro", () => {
    render(<Tela />);
    fireEvent.click(screen.getByRole("button", { name: "Por quê: Meio" }));
    const painel = document.querySelector('[data-porque-aberto="pq-corpo"]') as HTMLElement;
    expect(painel.textContent).toContain(frase("R-COPY-13"));
    expect(painel.textContent).toContain(frase("R-COPY-12"));
    expect(painel.textContent).not.toContain(frase("R-COPY-01"));
    expect(painel.textContent!.indexOf(frase("R-COPY-13"))).toBeLessThan(painel.textContent!.indexOf(frase("R-COPY-12")));
    expect(painel.textContent).toContain("uma regra de escrita para vídeo");
    expect(painel.textContent).not.toMatch(/R-[A-Z]+-[0-9]/);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("no YouTube o link leva ao segundo e o texto diz o tempo", () => {
    render(
      <PorQuesProvider itens={[ITENS[0]]} videos={{ 7: { url: "https://www.youtube.com/watch?v=abc", conta: "@c", vezes: null } }}>
        <PorQueBotao chaves={["gancho"]} id="pq-gancho" rotuloDoBloco="Abertura" />
        <PorQueAberto chaves={["gancho"]} id="pq-gancho" />
      </PorQuesProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Por quê: Abertura" }));
    const link = screen.getByRole("link", { name: "Ver o vídeo, a partir de 1:23" });
    expect(link.getAttribute("href")).toBe("https://www.youtube.com/watch?v=abc&t=83s");
  });

  it("enderecoNoSegundo: só o YouTube com segundo maior que zero ganha o tempo", () => {
    expect(enderecoNoSegundo("https://youtu.be/abc", 12)).toEqual({ href: "https://youtu.be/abc?t=12s", comSegundo: true });
    expect(enderecoNoSegundo("https://www.youtube.com/watch?v=abc", 0)).toEqual({ href: "https://www.youtube.com/watch?v=abc", comSegundo: false });
    expect(enderecoNoSegundo("https://www.instagram.com/reel/x/", 30)).toEqual({ href: "https://www.instagram.com/reel/x/", comSegundo: false });
    expect(enderecoNoSegundo("sem endereco", 30).comSegundo).toBe(false);
  });

  it("vídeo que não veio do servidor: a linha 'Com base em' some em vez de ficar vazia", () => {
    render(
      <PorQuesProvider itens={[ITENS[0]]} videos={{}}>
        <PorQueBotao chaves={["gancho"]} id="pq-gancho" rotuloDoBloco="Abertura" />
        <PorQueAberto chaves={["gancho"]} id="pq-gancho" />
      </PorQuesProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Por quê: Abertura" }));
    expect(screen.getByText("O que faz:")).toBeTruthy();
    expect(screen.queryByText("Com base em:")).toBeNull();
  });

  it("com 'Ver os porquês' ligado, o botão de um bloco o fecha e abre de novo; aria-controls só quando aberto", () => {
    render(<Tela />);
    const botao = screen.getByRole("button", { name: "Por quê: Abertura" });
    expect(botao.getAttribute("aria-controls")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver os porquês" }));
    expect(botao.getAttribute("aria-controls")).toBe("pq-gancho");
    fireEvent.click(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[data-porque-aberto="pq-gancho"]')).toBeNull();
    expect(screen.getAllByText("O que faz:").length).toBe(3);
    fireEvent.click(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Fechar os porquês" }));
    expect(screen.queryByText("O que faz:")).toBeNull();
  });

  it("fechar um bloco com todos abertos, fechar todos e abrir todos de novo: o bloco volta aberto (a escolha de um a um não fica)", () => {
    render(<Tela />);
    const botao = screen.getByRole("button", { name: "Por quê: Abertura" });
    fireEvent.click(screen.getByRole("button", { name: "Ver os porquês" }));
    fireEvent.click(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Fechar os porquês" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver os porquês" }));
    expect(botao.getAttribute("aria-expanded")).toBe("true");
  });

  it("o Como editar (BlocoEdicao) mostra o botão no item das frases na tela, e só quando há por quê", () => {
    const itens = [{ icone: Type, rotulo: "Texto na tela", texto: "a mancha voltou?", porQueChaves: ["tela:0"] }];
    render(
      <PorQuesProvider itens={[ITENS[2]]}>
        <BlocoEdicao titulo="Como editar" itens={itens} />
      </PorQuesProvider>,
    );
    const botao = screen.getByRole("button", { name: "Por quê: Texto na tela" });
    fireEvent.click(botao);
    expect(screen.getByText("O que faz:")).toBeTruthy();
    cleanup();
    render(
      <PorQuesProvider itens={[]}>
        <BlocoEdicao titulo="Como editar" itens={itens} />
      </PorQuesProvider>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("as frases na tela: um botão, uma seção por frase", () => {
    render(<Tela />);
    fireEvent.click(screen.getByRole("button", { name: "Por quê: Texto na tela" }));
    expect(screen.getByText("Frase 1 na tela")).toBeTruthy();
    expect(screen.getByText("Frase 2 na tela")).toBeTruthy();
  });

  it("'Ver os porquês' abre todos, 'Fechar os porquês' fecha todos", () => {
    render(<Tela />);
    fireEvent.click(screen.getByRole("button", { name: "Ver os porquês" }));
    expect(screen.getAllByText("O que faz:").length).toBe(4);
    expect(screen.getByRole("button", { name: "Por quê: Abertura" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Fechar os porquês" }));
    expect(screen.queryByText("O que faz:")).toBeNull();
  });

  it("roteiro antigo (sem porQueDosBlocos): nenhuma palavra 'Por quê' e nenhum 'Ver os porquês'", () => {
    render(<Tela itens={[]} />);
    expect(screen.queryByText(/Por quê/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver os porquês" })).toBeNull();
  });

  it("sem o provider (modo gravação, PDF) o botão e o painel não desenham nada", () => {
    render(
      <>
        <PorQueBotao chaves={["gancho"]} id="x" rotuloDoBloco="Abertura" />
        <PorQueAberto chaves={["gancho"]} id="x" />
      </>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("vídeo sem link (não era https): mostra a conta e não mostra o link", () => {
    render(
      <PorQuesProvider itens={[ITENS[0]]} videos={{ 7: { url: null, conta: "@limpeza_da_casa", vezes: null } }}>
        <PorQueBotao chaves={["gancho"]} id="pq-gancho" rotuloDoBloco="Abertura" />
        <PorQueAberto chaves={["gancho"]} id="pq-gancho" />
      </PorQuesProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Por quê: Abertura" }));
    expect(screen.getByText("O vídeo de @limpeza_da_casa.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
