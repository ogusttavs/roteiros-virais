/** "Vozes do público" no admin do setor (E28, parte 4): de quando é a leitura e se ainda vale, o que passou do piso e o que ficou de fora, e os links dos vídeos. */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { POR_TIPO_NO_SETOR } from "@/servicos/comentarios-do-publico";
import type { VozDoAdmin } from "@/servicos/vozes-do-publico";

import { idsDeVideoDasVozes, VozesDoPublico, type VideoLinkavelDaVoz } from "./VozesDoPublico";

afterEach(cleanup);

const voz = (texto: string, vezes: number, extra: Partial<VozDoAdmin> = {}): VozDoAdmin => ({
  chave: `k-${extra.tipo ?? "duvida"}-${texto}`,
  tipo: "duvida",
  texto,
  vezes,
  plataformas: ["youtube"],
  videos: [1, 2],
  passouDoPiso: vezes >= 5,
  ...extra,
});

const VIDEOS = new Map<number, VideoLinkavelDaVoz>([
  [1, { titulo: "Como tirar mancha do sofá", url: "https://exemplo.invalido/v1" }],
  [2, { titulo: null, url: "https://exemplo.invalido/v2" }],
]);

const LEITURA = { comentarios: 840, videos: 12, plataformas: ["youtube" as const], lidaEm: new Date("2026-10-11T07:45:00Z") };

function montar(sobre: Partial<Parameters<typeof VozesDoPublico>[0]> = {}) {
  return render(
    <VozesDoPublico
      duvidas={[voz("Serve em tecido de camurça?", 14), voz("Pergunta de poucos comentários?", 3)]}
      objecoes={[voz("A mancha voltou depois de secar", 7, { tipo: "objecao" })]}
      pedidos={[]}
      leitura={LEITURA}
      vale
      validaAte={new Date("2026-10-25T07:45:00Z")}
      piso={5}
      videos={VIDEOS}
      {...sobre}
    />,
  );
}

describe("VozesDoPublico", () => {
  it("com leitura que vale: diz quantos comentários, de quantos vídeos, de qual plataforma, de quando é e até quando vale", () => {
    const { container } = montar();
    const secao = container.querySelector("[data-vozes-do-publico]")!;
    expect(secao.getAttribute("data-vozes-do-publico")).toBe("vale");
    expect(within(secao as HTMLElement).getByRole("heading", { name: "vozes do público", level: 2 })).toBeTruthy();
    expect(container.querySelector("[data-vozes-leitura]")!.textContent).toBe("de 840 comentários de 12 vídeos do YouTube, lidos em 11 de outubro");
    expect(container.querySelector("[data-vozes-validade]")!.textContent).toContain("vale até 25 de outubro");
  });

  it("mostra as três listas, cada tabela com o nome da sua lista, e o que está abaixo do piso aparece dito, não escondido", () => {
    montar();
    expect(screen.getByRole("heading", { name: "dúvidas mais repetidas", level: 3 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "objeções", level: 3 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "pedidos", level: 3 })).toBeTruthy();
    expect(screen.getByRole("table", { name: "dúvidas mais repetidas" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "objeções" })).toBeTruthy();
    const linhaBoa = screen.getByText("Serve em tecido de camurça?").closest("tr")!;
    expect(linhaBoa.getAttribute("data-voz-passou-do-piso")).toBe("sim");
    expect(within(linhaBoa).getByText("passou do piso")).toBeTruthy();
    const linhaFraca = screen.getByText("Pergunta de poucos comentários?").closest("tr")!;
    expect(linhaFraca.getAttribute("data-voz-passou-do-piso")).toBe("nao");
    expect(within(linhaFraca).getByText("abaixo do piso de 5")).toBeTruthy();
    // a lista que não tem nada diz isso, em vez de uma tabela vazia
    expect(screen.getByText("nenhuma nesta leitura")).toBeTruthy();
  });

  it("cada linha diz em quantos vídeos a voz apareceu e linka os primeiros, com o título quando há", () => {
    montar();
    const linha = screen.getByText("Serve em tecido de camurça?").closest("tr")!;
    expect(within(linha).getByText("em 2 vídeos", { exact: false })).toBeTruthy();
    const primeiro = within(linha).getByRole("link", { name: "ver vídeo 1: Como tirar mancha do sofá" });
    expect(primeiro.textContent).toBe("1");
    expect(primeiro.getAttribute("href")).toBe("https://exemplo.invalido/v1");
    expect(primeiro.getAttribute("target")).toBe("_blank");
    expect(primeiro.getAttribute("rel")).toContain("noopener");
    // sem título guardado, o link continua, com o nome visível
    expect(within(linha).getByRole("link", { name: "ver vídeo 2" }).getAttribute("href")).toBe("https://exemplo.invalido/v2");
  });

  it("o endereço que não é https seguro não vira link, e a linha segue sem ele", () => {
    montar({ videos: new Map([[1, { titulo: "Roubado", url: "javascript:alert(1)" }]]), duvidas: [voz("Com endereço ruim?", 9, { videos: [1] })], objecoes: [] });
    const linha = screen.getByText("Com endereço ruim?").closest("tr")!;
    expect(within(linha).queryByRole("link")).toBeNull();
    expect(within(linha).getByText("em 1 vídeo", { exact: false })).toBeTruthy();
  });

  it("linka no máximo três vídeos por linha, e diz em quantos a voz apareceu", () => {
    const muitos = new Map<number, VideoLinkavelDaVoz>([1, 2, 3, 4, 5].map((id) => [id, { titulo: `Vídeo ${id}`, url: `https://exemplo.invalido/v${id}` }]));
    montar({ duvidas: [voz("Em muitos vídeos?", 9, { videos: [1, 2, 3, 4, 5] })], objecoes: [], videos: muitos });
    const linha = screen.getByText("Em muitos vídeos?").closest("tr")!;
    expect(within(linha).getByText("em 5 vídeos", { exact: false })).toBeTruthy();
    expect(within(linha).getAllByRole("link").map((a) => a.textContent)).toEqual(["1", "2", "3"]);
  });

  it("a plataforma de cada voz vem dita, e a que não tem diz que não tem", () => {
    montar({ duvidas: [voz("Serve?", 6, { plataformas: ["youtube", "instagram"] }), voz("Sem rede?", 6, { plataformas: [] })] });
    expect(screen.getByText("Serve?").closest("tr")!.textContent).toContain("YouTube e Instagram");
    expect(screen.getByText("Sem rede?").closest("tr")!.textContent).toContain("sem plataforma");
  });

  it("leitura velha: diz de quando é, que já não entra nos temas nem no roteiro, e a linha que passou do piso não diz que é usada", () => {
    const { container } = montar({ vale: false });
    expect(container.querySelector("[data-vozes-do-publico]")!.getAttribute("data-vozes-do-publico")).toBe("velha");
    expect(container.querySelector("[data-vozes-validade]")!.textContent).toBe("leitura velha, de 11 de outubro: já não entra nos temas nem no roteiro, e a próxima rodada é no domingo");
    const linha = screen.getByText("Serve em tecido de camurça?").closest("tr")!;
    expect(within(linha).getByText("passou do piso, leitura velha")).toBeTruthy();
    expect(within(linha).queryByText("passou do piso")).toBeNull();
  });

  it("sem leitura nenhuma: o estado vazio explica a rotina e não parece erro", () => {
    const { container } = montar({ leitura: null, duvidas: [], objecoes: [], pedidos: [], validaAte: null });
    expect(container.querySelector("[data-vozes-do-publico]")!.getAttribute("data-vozes-do-publico")).toBe("sem");
    expect(screen.getByText(/ainda sem vozes neste ramo/)).toBeTruthy();
    expect(container.querySelector("[data-vozes-leitura]")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("a leitura rodou e não juntou nenhuma voz: mostra o que foi lido e diz isso, diferente de 'nunca rodou'", () => {
    const { container } = montar({ duvidas: [], objecoes: [], pedidos: [] });
    expect(container.querySelector("[data-vozes-do-publico]")!.getAttribute("data-vozes-do-publico")).toBe("vazia");
    expect(container.querySelector("[data-vozes-leitura]")!.textContent).toContain("de 840 comentários de 12 vídeos");
    expect(screen.getByText(/a leitura rodou e não juntou nenhuma pergunta/)).toBeTruthy();
    expect(screen.queryByText(/ainda sem vozes neste ramo/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("corta cada lista no que o job guarda, e o título da lista diz quantas aparecem de quantas", () => {
    const duvidas = Array.from({ length: POR_TIPO_NO_SETOR.duvida + 2 }, (_, i) => voz(`Dúvida número ${i + 1}?`, 30 - i));
    const objecoes = Array.from({ length: POR_TIPO_NO_SETOR.objecao + 2 }, (_, i) => voz(`Objeção número ${i + 1}`, 20 - i, { tipo: "objecao" }));
    const pedidos = Array.from({ length: POR_TIPO_NO_SETOR.pedido + 2 }, (_, i) => voz(`Pedido número ${i + 1}`, 15 - i, { tipo: "pedido" }));
    montar({ duvidas, objecoes, pedidos });
    expect(screen.getByText(`Dúvida número ${POR_TIPO_NO_SETOR.duvida}?`)).toBeTruthy();
    expect(screen.queryByText(`Dúvida número ${POR_TIPO_NO_SETOR.duvida + 1}?`)).toBeNull();
    expect(screen.getByText(`Objeção número ${POR_TIPO_NO_SETOR.objecao}`)).toBeTruthy();
    expect(screen.queryByText(`Objeção número ${POR_TIPO_NO_SETOR.objecao + 1}`)).toBeNull();
    expect(screen.getByText(`Pedido número ${POR_TIPO_NO_SETOR.pedido}`)).toBeTruthy();
    expect(screen.queryByText(`Pedido número ${POR_TIPO_NO_SETOR.pedido + 1}`)).toBeNull();
    const contagemDe = (titulo: string) => document.querySelector(`[data-vozes-lista='${titulo}'] h3`)!.nextElementSibling!.textContent;
    expect(contagemDe("dúvidas mais repetidas")).toBe(`${POR_TIPO_NO_SETOR.duvida} de ${POR_TIPO_NO_SETOR.duvida + 2}`);
    expect(contagemDe("objeções")).toBe(`${POR_TIPO_NO_SETOR.objecao} de ${POR_TIPO_NO_SETOR.objecao + 2}`);
    expect(contagemDe("pedidos")).toBe(`${POR_TIPO_NO_SETOR.pedido} de ${POR_TIPO_NO_SETOR.pedido + 2}`);
  });
});

describe("idsDeVideoDasVozes", () => {
  it("junta os três primeiros vídeos das linhas mostradas de cada lista, sem repetir, e não pega o que o corte esconde", () => {
    const comVideos = (prefixo: number, n: number, quantos: number) =>
      Array.from({ length: n }, (_, i) => voz(`${prefixo}-${i}`, 20 - i, { videos: Array.from({ length: quantos }, (_, j) => prefixo * 1000 + i * 10 + j) }));
    const duvidas = comVideos(1, POR_TIPO_NO_SETOR.duvida + 2, 5);
    const objecoes = comVideos(2, POR_TIPO_NO_SETOR.objecao + 2, 5);
    const pedidos = comVideos(3, POR_TIPO_NO_SETOR.pedido + 2, 5);
    const ids = idsDeVideoDasVozes({ duvidas, objecoes, pedidos });
    expect(ids).toHaveLength(3 * (POR_TIPO_NO_SETOR.duvida + POR_TIPO_NO_SETOR.objecao + POR_TIPO_NO_SETOR.pedido));
    expect(new Set(ids).size).toBe(ids.length);
    // o quarto vídeo de uma linha e as linhas cortadas ficam de fora
    expect(ids).not.toContain(1003);
    expect(ids).not.toContain(1000 + POR_TIPO_NO_SETOR.duvida * 10);
    expect(ids).toContain(2000);
    expect(ids).toContain(3002);
  });

  it("o mesmo vídeo em várias linhas entra uma vez só", () => {
    const iguais = [voz("A?", 9, { videos: [7, 8] }), voz("B?", 8, { videos: [8, 9] })];
    expect(idsDeVideoDasVozes({ duvidas: iguais, objecoes: [], pedidos: [] }).sort()).toEqual([7, 8, 9]);
  });
});
