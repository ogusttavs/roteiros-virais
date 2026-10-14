/** "Vídeos longos do YouTube" no admin do setor (E52, PR 1): a amostra dita com a força dela, a duração e a estrutura típicas, e a lista dos longos com o link e a lista de capítulos. */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { MedidaDosLongos, VideoLongoDoSetor } from "@/servicos/videos-longos";

import { VideosLongosDoSetor } from "./VideosLongosDoSetor";

afterEach(cleanup);

const longo = (id: number, parcial: Partial<VideoLongoDoSetor> = {}): VideoLongoDoSetor => ({
  id,
  idExterno: `v${id}`,
  url: `https://exemplo.invalido/v${id}`,
  titulo: `[exemplo] vídeo ${id}`,
  views: 120_000 + id,
  duracaoS: 540,
  publicadoEm: new Date("2026-10-08T12:00:00Z"),
  foraDaCurva: 3,
  contaId: id,
  classificacao: "brasileiro",
  capitulos: [],
  temTranscricao: false,
  proximaTentativaTranscricao: null,
  temAnaliseLonga: false,
  proximaTentativaAnaliseLonga: null,
  ...parcial,
});

const MEDIDA: MedidaDosLongos = {
  amostra: 12,
  brasileiros: 9,
  forca: "indicio",
  duracaoS: { p25: 420, mediana: 540, p75: 780 },
  capitulos: { videosComLista: 7, quantidadeMediana: 6, tamanhoMedianoS: 100, forca: "indicio" },
  titulos: [],
};

function montar(sobre: Partial<Parameters<typeof VideosLongosDoSetor>[0]> = {}) {
  return render(
    <VideosLongosDoSetor
      medida={MEDIDA}
      lista={[
        longo(1, { capitulos: [{ inicioS: 0, titulo: "A" }, { inicioS: 100, titulo: "B" }, { inicioS: 200, titulo: "C" }], temTranscricao: true, temAnaliseLonga: true }),
        longo(2, { titulo: null }),
      ]}
      totalNaLista={2}
      piso={50_000}
      lidosNaSemana={1}
      porSemana={5}
      tetoS={180}
      maximoS={2400}
      janelaDaListaDias={30}
      janelaDaMedidaDias={90}
      {...sobre}
    />,
  );
}

describe("VideosLongosDoSetor", () => {
  it("diz quantos vídeos, em que janela, acima de que piso e a força da amostra", () => {
    const { container } = montar();
    const secao = container.querySelector("[data-longos-do-setor]")!;
    expect(secao.getAttribute("data-longos-do-setor")).toBe("indicio");
    expect(within(secao as HTMLElement).getByRole("heading", { name: "vídeos longos do YouTube", level: 2 })).toBeTruthy();
    expect(container.querySelector("[data-longos-medida]")!.textContent).toBe(
      "12 vídeos longos nos últimos 90 dias, acima de 50.000 visualizações: ainda é indício (de 3 a 29 vídeos): não vale como regra",
    );
  });

  it("diz a parte brasileira da amostra, e que a duração conta também os de fora quando há", () => {
    const { container } = montar();
    expect(container.querySelector("[data-longos-brasileiros]")!.textContent).toBe(
      "brasileiros: 9 de 12; a duração acima conta também os de fora, e a prova com a chave real decide se deve contar só os brasileiros",
    );
    const todos = montar({ medida: { ...MEDIDA, brasileiros: 12 } });
    expect(todos.container.querySelector("[data-longos-brasileiros]")!.textContent).toBe("brasileiros: 12 de 12");
    // sem a linha de duração (menos de 3 vídeos), a frase não aponta para uma linha que não existe
    const poucos = montar({ medida: { ...MEDIDA, amostra: 2, brasileiros: 1, forca: "nenhuma", duracaoS: null, capitulos: null } });
    expect(poucos.container.querySelector("[data-longos-brasileiros]")!.textContent).toBe("brasileiros: 1 de 2");
    // sem nenhum vídeo da amostra (só de outro idioma), a linha nem aparece
    const nenhum = montar({ medida: { ...MEDIDA, amostra: 0, brasileiros: 0, forca: "nenhuma", duracaoS: null, capitulos: null } });
    expect(nenhum.container.querySelector("[data-longos-brasileiros]")).toBeNull();
  });

  it("a duração e a estrutura típicas, e quantos foram lidos na semana", () => {
    const { container } = montar();
    expect(container.querySelector("[data-longos-duracao]")!.textContent).toBe("duração típica: de 7 a 13 minutos, a mediana é 9");
    expect(container.querySelector("[data-longos-estrutura]")!.textContent).toBe(
      "7 de 12 têm a lista de capítulos na descrição: em geral 6 capítulos, de uns 2 minutos cada (ainda é indício)",
    );
    expect(container.querySelector("[data-longos-lidos]")!.textContent).toContain("lidos por transcrição nesta semana: 1; o limite é de 5 por semana neste ramo");
  });

  it("sem estrutura medida, diz que ainda não há; sem duração medida, não escreve a linha", () => {
    const { container } = montar({ medida: { ...MEDIDA, amostra: 2, forca: "nenhuma", duracaoS: null, capitulos: null } });
    expect(container.querySelector("[data-longos-estrutura]")!.textContent).toContain("ainda sem estrutura típica");
    expect(container.querySelector("[data-longos-duracao]")).toBeNull();
    expect(container.querySelector("[data-longos-medida]")!.textContent).toContain("poucos vídeos para medir");
  });

  it("vale como regra com a amostra grande, e a estrutura tem a força dela: 30 longos com 7 listas medem a duração como regra e a estrutura como indício", () => {
    const { container } = montar({ medida: { ...MEDIDA, amostra: 30, forca: "regra" } });
    expect(container.querySelector("[data-longos-medida]")!.textContent).toContain("vale como regra");
    expect(container.querySelector("[data-longos-estrutura]")!.textContent).toContain("7 de 30");
    expect(container.querySelector("[data-longos-estrutura]")!.textContent).toContain("ainda é indício");
  });

  it("a estrutura com 30 listas vale como regra", () => {
    const { container } = montar({ medida: { ...MEDIDA, amostra: 30, forca: "regra", capitulos: { videosComLista: 30, quantidadeMediana: 6, tamanhoMedianoS: 100, forca: "regra" } } });
    expect(container.querySelector("[data-longos-estrutura]")!.textContent).toContain("vale como regra");
  });

  it("lista cada longo com o link, a duração, as visualizações, os capítulos e se foi lido; sem título usa o código do vídeo", () => {
    const { container } = montar();
    const linhas = container.querySelectorAll("[data-longo]");
    expect(linhas).toHaveLength(2);
    const primeira = linhas[0] as HTMLElement;
    expect(within(primeira).getByRole("link", { name: "[exemplo] vídeo 1" }).getAttribute("href")).toBe("https://exemplo.invalido/v1");
    expect(primeira.textContent).toContain("9 min");
    expect(primeira.textContent).toContain("120.001");
    expect(primeira.textContent).toContain("3 capítulos");
    expect(primeira.textContent).toContain("transcrito e lido");
    const segunda = linhas[1] as HTMLElement;
    expect(within(segunda).getByRole("link", { name: "v2" })).toBeTruthy();
    expect(segunda.textContent).toContain("sem lista");
    expect(segunda.textContent).toContain("ainda não");
  });

  it("o longo só transcrito diz isso, sem dizer que a estrutura foi lida", () => {
    const { container } = montar({ lista: [longo(5, { temTranscricao: true })], totalNaLista: 1 });
    const linha = container.querySelector("[data-longo]") as HTMLElement;
    expect(linha.textContent).toContain("transcrito");
    expect(linha.textContent).not.toContain("transcrito e lido");
  });

  it("o endereço que não é https não vira link, e a lista cortada diz quantos aparecem de quantos", () => {
    montar({ lista: [longo(1, { url: "javascript:alert(1)" })], totalNaLista: 14 });
    expect(screen.queryByRole("link", { name: "[exemplo] vídeo 1" })).toBeNull();
    expect(screen.getByText("[exemplo] vídeo 1")).toBeTruthy();
    expect(screen.getByText("1 de 14")).toBeTruthy();
  });

  it("sem nenhum longo, mostra o que entra com os números de verdade e nenhuma tabela", () => {
    const { container } = montar({ medida: { amostra: 0, brasileiros: 0, forca: "nenhuma", duracaoS: null, capitulos: null, titulos: [] }, lista: [], totalNaLista: 0 });
    expect(container.querySelector("[data-longos-do-setor]")!.getAttribute("data-longos-do-setor")).toBe("nenhuma");
    expect(screen.getByText(/mais de 3 minutos e até 40 minutos, do ramo, com mais de 50\.000 visualizações/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("o que é longo vem da configuração: o mínimo dito é o teto dos curtos, não um número fixo no texto", () => {
    montar({ medida: { amostra: 0, brasileiros: 0, forca: "nenhuma", duracaoS: null, capitulos: null, titulos: [] }, lista: [], totalNaLista: 0, tetoS: 300, maximoS: 3600 });
    expect(screen.getByText(/mais de 5 minutos e até 60 minutos/)).toBeTruthy();
  });

  it("com medida mas sem longo na janela curta, a lista diz isso e a medida continua à vista", () => {
    const { container } = montar({ lista: [], totalNaLista: 0 });
    expect(container.querySelector("[data-longos-medida]")).not.toBeNull();
    expect(screen.getByText(/nenhum longo acima do piso nos últimos 30 dias/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
