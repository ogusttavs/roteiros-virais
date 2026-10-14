/**
 * O cartão do vídeo longo nas Referências (E52, PR 4c): com a leitura da estrutura mostra "o capítulo que interessa" e "Ver o capítulo" (no segundo dele); sem ela, só "Ver desde o começo"
 * (nunca um capítulo inventado); os capítulos da descrição vêm limitados e a capa que falha cai no retângulo neutro.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReferenciaLongoCartao, type LongoFormatado } from "./ReferenciaLongoCartao";

const base: LongoFormatado = {
  id: 7,
  multiplo: "4,6x",
  rotuloMultiplo: "acima do normal dessa conta",
  faixaMultiplo: "acima",
  views: 412_000,
  medianaConta: 89_500,
  contaNome: "Casa Limpa Vídeos",
  plataformaData: "YouTube, 28 de agosto",
  titulo: "os 4 erros que estragam o sofá",
  capaUrl: "https://exemplo.invalido/capa.jpg",
  duracaoTexto: "11:02",
  capitulos: [
    { tempo: "0:00", titulo: "Abertura" },
    { tempo: "1:00", titulo: "Primeiro erro" },
  ],
  maisCapitulos: 0,
  capituloQueInteressa: { inicioS: 192, de: "3:12", ate: "4:05", nome: "o teste no canto escondido", promessa: "mostra o antes e o depois", esquerdaPct: 29, larguraPct: 8 },
};

function montar(video: LongoFormatado = base, extra: { salvo?: boolean; semRede?: boolean } = {}) {
  const onVer = vi.fn();
  const onSalvar = vi.fn();
  render(<ReferenciaLongoCartao video={video} salvo={extra.salvo ?? false} semRede={extra.semRede} onVer={onVer} onSalvar={onSalvar} />);
  return { onVer, onSalvar };
}

afterEach(cleanup);

describe("ReferenciaLongoCartao", () => {
  it("mostra a duração na capa, os números, a conta, o selo de vídeo longo e o título", () => {
    montar();
    expect(screen.getByText("11:02")).toBeTruthy();
    expect(screen.getByText("4,6x")).toBeTruthy();
    expect(screen.getByText("Casa Limpa Vídeos")).toBeTruthy();
    expect(screen.getByText("YouTube, 28 de agosto")).toBeTruthy();
    expect(screen.getByText("Vídeo longo")).toBeTruthy();
    expect(screen.getByText("os 4 erros que estragam o sofá")).toBeTruthy();
    expect(screen.getByText(/412\.000/)).toBeTruthy();
    expect(screen.getByText(/89\.500/)).toBeTruthy();
  });

  it("com a leitura, mostra o capítulo que interessa com o tempo, a promessa e o trilho, e 'Ver o capítulo' abre a prévia no segundo dele", () => {
    const { onVer } = montar();
    const bloco = document.querySelector("[data-capitulo-que-interessa]") as HTMLElement;
    expect(bloco.textContent).toContain("O capítulo que interessa:");
    expect(bloco.textContent).toContain("3:12 a 4:05");
    expect(bloco.textContent).toContain("o teste no canto escondido");
    expect(bloco.textContent).toContain("O título promete: mostra o antes e o depois");
    const trilho = screen.getByRole("img", { name: "O capítulo de referência, de 3:12 a 4:05, num vídeo de 11:02" });
    const marca = trilho.querySelector("i") as HTMLElement;
    expect(marca.style.left).toBe("29%");
    expect(marca.style.width).toBe("8%");
    fireEvent.click(screen.getByRole("button", { name: "Ver o capítulo de referência do vídeo de Casa Limpa Vídeos" }));
    expect(onVer).toHaveBeenCalledWith(192);
    expect(screen.queryByText("Ver desde o começo")).toBeNull();
  });

  it("sem a leitura não há capítulo que interessa nem trilho: o botão é 'Ver desde o começo' e abre no segundo zero", () => {
    const { onVer } = montar({ ...base, capituloQueInteressa: null });
    expect(document.querySelector("[data-capitulo-que-interessa]")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("Ver o capítulo")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver o vídeo de Casa Limpa Vídeos desde o começo" }));
    expect(onVer).toHaveBeenCalledWith(0);
  });

  it("a lista dos capítulos da descrição traz o tempo e o nome, e diz quantos faltam; sem capítulos a lista nem aparece", () => {
    montar({ ...base, maisCapitulos: 2 });
    const lista = document.querySelector("[data-capitulos-da-descricao]") as HTMLElement;
    expect(lista.textContent).toContain("0:00Abertura");
    expect(lista.textContent).toContain("1:00Primeiro erro");
    expect(lista.textContent).toContain("e mais 2");
    cleanup();
    montar({ ...base, capitulos: [], maisCapitulos: 0 });
    expect(document.querySelector("[data-capitulos-da-descricao]")).toBeNull();
  });

  it("o nome do ramo aparece quando o vídeo é de um ramo alternativo", () => {
    montar({ ...base, ramoNome: "Odontologia" });
    expect(document.querySelector("[data-selo-ramo]")?.textContent).toBe("Odontologia");
  });

  it("salvar chama a ação; sem rede o botão fica desabilitado; salvo mostra o nome certo", () => {
    const { onSalvar } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSalvar).toHaveBeenCalledTimes(1);
    cleanup();
    montar(base, { semRede: true });
    expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    montar(base, { salvo: true });
    expect(screen.getByRole("button", { name: "Salvo" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("a capa que falha cai no retângulo neutro, sem imagem quebrada", () => {
    montar();
    const imagem = document.querySelector("img") as HTMLImageElement;
    fireEvent.error(imagem);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("11:02")).toBeTruthy();
  });
});
