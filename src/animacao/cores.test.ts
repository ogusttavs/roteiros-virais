import { describe, expect, it } from "vitest";

import { contraste } from "@/carrossel/modelos";

import { canais, CONTRASTE_DO_DESTAQUE, CONTRASTE_DO_TEXTO, coresDaAnimacao, cromaDe } from "./cores";
import { MARCA_PADRAO } from "./montador";

// Cores de marca de todo tipo: as escuras (azul-marinho, preto) e as claras demais (amarelo, branco) são as que dão trabalho.
const MARCAS = ["#0e5a6a", "#1b3a8c", "#0b1f4d", "#000000", "#ffffff", "#ffd400", "#e8c15a", "#d81b60", "#2e7d32", "#7c3aed", "#ff7a00", "#3a3633"];

describe("coresDaAnimacao", () => {
  it.each(MARCAS)("%s: o texto passa de 7 para 1 e o destaque de 4,5 para 1 sobre o fundo", (cor) => {
    const c = coresDaAnimacao(cor);
    expect(contraste(c.texto, c.fundo)).toBeGreaterThanOrEqual(CONTRASTE_DO_TEXTO);
    expect(contraste(c.destaque, c.fundo)).toBeGreaterThanOrEqual(CONTRASTE_DO_DESTAQUE);
    // A pílula do @: a tinta sobre o destaque cheio.
    expect(contraste(c.sobreDestaque, c.destaque)).toBeGreaterThanOrEqual(CONTRASTE_DO_DESTAQUE);
  });
  it("o destaque é da família da marca, não um branco qualquer: muda quando a marca muda", () => {
    expect(coresDaAnimacao("#0e5a6a").destaque).not.toBe(coresDaAnimacao("#d81b60").destaque);
    expect(coresDaAnimacao("#0e5a6a").fundo).not.toBe(coresDaAnimacao("#d81b60").fundo);
  });
  it("a cor viva que já lê bem sobre o fundo escuro é o próprio destaque", () => {
    expect(coresDaAnimacao("#ffd400").destaque).toBe("#ffd400");
    expect(coresDaAnimacao("#FF7A00").destaque).toBe("#ff7a00");
  });
  it("a cor escura clareia sem virar cinza: o destaque guarda a força da cor da marca", () => {
    for (const cor of ["#0e5a6a", "#1b3a8c", "#0b1f4d", "#2e7d32"]) expect(cromaDe(coresDaAnimacao(cor).destaque)).toBeGreaterThan(cromaDe(cor) * 0.6);
  });
  it("marca sem cor (preto, branco, cinza): o destaque é o dourado do produto, não um cinza", () => {
    for (const cor of ["#000000", "#ffffff", "#3a3633"]) expect(coresDaAnimacao(cor).destaque).toBe(MARCA_PADRAO.corDestaque);
  });
  it("o fundo é escuro (a marca afundada no quase preto)", () => {
    for (const cor of MARCAS) {
      const [r, g, b] = canais(coresDaAnimacao(cor).fundo);
      expect(Math.max(r, g, b)).toBeLessThan(80);
    }
  });
  it("tudo sai em #rrggbb, o único formato que vai para o CSS do molde", () => {
    for (const cor of MARCAS) for (const valor of Object.values(coresDaAnimacao(cor))) expect(valor).toMatch(/^#[0-9a-f]{6}$/);
  });
});
