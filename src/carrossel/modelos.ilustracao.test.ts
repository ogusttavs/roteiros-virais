import { describe, expect, it } from "vitest";

import type { SlideDoCarrossel } from "@/config/carrossel";

import { fotoDeFundoDoSlide } from "./fotos";
import { slideHTML, type DadosDoModelo } from "./modelos";

const IMAGEM = { tipo: "image/jpeg", base64: "AAAA" };
const base = (slide: SlideDoCarrossel, extra: Partial<DadosDoModelo> = {}): DadosDoModelo => ({
  slide,
  numero: 2,
  total: 7,
  cor: "#0f6b7a",
  arroba: "@clinica.exemplo",
  modo: "claro",
  fontes: { mona: null, mono: null },
  ...extra,
});
const ITEM: SlideDoCarrossel = { tipo: "item", titulo: "O aparelho segura placa", texto: "Braquete e fio criam cantos." };

describe("slideHTML com ilustracao", () => {
  it("leve: veu geral 28, degrade de 92 no alto e no pe, painel de 93 atras do texto", () => {
    const html = slideHTML(base(ITEM, { ilustracao: { ...IMAGEM, estilo: "leve", reforco: 0 } }));
    expect(html).toContain("veu-leve");
    expect(html).toContain("--painel:93%");
    expect(html).toContain("url(data:image/jpeg;base64,AAAA)");
    expect(html).toMatch(/linear-gradient\(180deg,color-mix\(in srgb,var\(--s-fundo\) 92%,transparent\) 0,color-mix\(in srgb,var\(--s-fundo\) 0%,transparent\) 230px\)/);
    expect(html).toContain("var(--s-fundo) 28%");
  });

  it("forte: so o veu (72 no claro, 78 no escuro, 84 na cor cheia), sem painel, e a ilustracao no lugar do fundo abstrato", () => {
    const claro = slideHTML(base(ITEM, { ilustracao: { ...IMAGEM, estilo: "forte", reforco: 0 }, fundos: ["F1", "F2", "F3", "F4", "F5", "F6"] }));
    expect(claro).not.toContain("veu-leve");
    expect(claro).not.toContain("--painel");
    expect(claro).toContain("var(--s-fundo) 72%");
    expect(claro).not.toContain("base64,F");
    expect(slideHTML(base(ITEM, { modo: "escuro", ilustracao: { ...IMAGEM, estilo: "forte", reforco: 0 } }))).toContain("var(--s-fundo) 78%");
    expect(slideHTML(base({ tipo: "chamada", titulo: "Agora", texto: "Mande", acoes: ["Salve", "Mande"] }, { modo: "marca", ilustracao: { ...IMAGEM, estilo: "forte", reforco: 0 } }))).toContain("var(--s-fundo) 84%");
  });

  it("o reforco sobe o veu escrito no slide", () => {
    expect(slideHTML(base(ITEM, { ilustracao: { ...IMAGEM, estilo: "forte", reforco: 3 } }))).toContain("var(--s-fundo) 87%");
  });

  it("antes e depois e resultado nunca desenham a ilustracao, nem se ela vier no pedido", () => {
    for (const slide of [
      { tipo: "antes-depois", titulo: "Antes e depois", antes: "a", depois: "b" } as SlideDoCarrossel,
      { tipo: "prova-resultado", titulo: "Resultado" } as SlideDoCarrossel,
    ]) {
      const html = slideHTML(base(slide, { ilustracao: { ...IMAGEM, estilo: "leve", reforco: 0 } }));
      expect(html).not.toContain("base64,AAAA");
      expect(html).not.toContain("ilustrado");
    }
  });

  it("o passo com foto da pessoa usa o modelo de foto e nao desenha a ilustracao de fundo", () => {
    const passo: SlideDoCarrossel = { tipo: "passo", titulo: "Escove", texto: "devagar", numero: 1, de: 2 };
    const html = slideHTML(base(passo, { foto: { tipo: "image/png", base64: "PESSOA" }, ilustracao: { ...IMAGEM, estilo: "leve", reforco: 0 } }));
    expect(html).toContain("PESSOA");
    expect(html).not.toContain("base64,AAAA");
  });

  it("sem ilustracao, o slide sai como antes (fundo abstrato quando ha)", () => {
    const html = slideHTML(base(ITEM, { fundos: ["F1", "F2", "F3", "F4", "F5", "F6"] }));
    expect(html).toContain("base64,F");
    expect(html).not.toContain("ilustrado");
  });

  it("a linha 'Imagem ilustrativa' so aparece quando pedida (marca de saude)", () => {
    expect(slideHTML(base(ITEM, { ilustracao: { ...IMAGEM, estilo: "forte", reforco: 0 }, ilustrativa: true }))).toContain("Imagem ilustrativa");
    expect(slideHTML(base(ITEM, { ilustracao: { ...IMAGEM, estilo: "forte", reforco: 0 } }))).not.toContain("Imagem ilustrativa");
  });
});

describe("a foto da pessoa que vira o fundo de um slide de texto", () => {
  const fotos = [{ id: 7 }, { id: 8, dePaciente: true }];
  it("so a que o slide aponta; nunca por sobra; em saude, nunca a de paciente", () => {
    expect(fotoDeFundoDoSlide({ ...ITEM, fotoId: 7 }, fotos)).toBe(7);
    expect(fotoDeFundoDoSlide(ITEM, fotos)).toBeNull();
    expect(fotoDeFundoDoSlide({ ...ITEM, fotoId: 8 }, fotos, true)).toBeNull();
    expect(fotoDeFundoDoSlide({ ...ITEM, fotoId: 99 }, fotos)).toBeNull();
    expect(fotoDeFundoDoSlide({ tipo: "antes-depois", titulo: "x", fotoId: 7 } as SlideDoCarrossel, fotos)).toBeNull();
  });
});
