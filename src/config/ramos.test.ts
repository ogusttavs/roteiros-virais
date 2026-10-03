import { describe, expect, it } from "vitest";

import { GRUPOS_DE_RAMO, RAMOS_DO_CATALOGO, SLUGS_DE_RAMO, grupoDoRamo, ramoPorSlug } from "./ramos";

describe("o catálogo de ramos aprovado em 02/10/2026", () => {
  it("tem 44 ramos em 9 grupos, na ordem e com os números do documento", () => {
    expect(RAMOS_DO_CATALOGO).toHaveLength(44);
    expect(GRUPOS_DE_RAMO).toHaveLength(9);
    expect(RAMOS_DO_CATALOGO.map((r) => r.numero)).toEqual(Array.from({ length: 44 }, (_, i) => i + 1));
  });

  it("cada grupo tem os ramos do documento (5, 4, 6, 4, 3, 4, 5, 9 e 4)", () => {
    const contagem = GRUPOS_DE_RAMO.map((g) => RAMOS_DO_CATALOGO.filter((r) => r.grupo === g.slug).length);
    expect(contagem).toEqual([5, 4, 6, 4, 3, 4, 5, 9, 4]);
  });

  it("slugs únicos, em minúsculas e sem acento (é a identidade que o banco guarda)", () => {
    expect(SLUGS_DE_RAMO.size).toBe(44);
    for (const r of RAMOS_DO_CATALOGO) expect(r.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("todo ramo tem nome, uma linha de exemplos e pelo menos uma palavra de busca; todo grupo citado existe", () => {
    for (const r of RAMOS_DO_CATALOGO) {
      expect(r.nome.trim(), r.slug).not.toBe("");
      expect(r.exemplos.trim(), r.slug).not.toBe("");
      expect(r.palavras.length, r.slug).toBeGreaterThan(0);
      expect(() => grupoDoRamo(r)).not.toThrow();
    }
  });

  it("nenhum texto do catálogo tem travessão ou emoji (regras 1 e 2 do projeto), e as palavras de busca não têm vazios", () => {
    const tudo = RAMOS_DO_CATALOGO.flatMap((r) => [r.nome, r.exemplos, ...r.palavras]).concat(GRUPOS_DE_RAMO.map((g) => g.nome));
    for (const texto of tudo) {
      expect(texto).not.toMatch(/[‒-―]/);
      expect(texto).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(texto.trim()).toBe(texto);
      expect(texto).not.toBe("");
    }
  });

  it("os cinco setores que já existem encaixam nos ramos do documento", () => {
    expect(ramoPorSlug("limpeza-e-organizacao-da-casa")?.numero).toBe(1);
    expect(ramoPorSlug("estetica-automotiva")?.numero).toBe(6);
    expect(ramoPorSlug("empreendedorismo-e-negocios")?.numero).toBe(41);
    expect(ramoPorSlug("maquiagem-e-cosmeticos")?.numero).toBe(19);
    expect(ramoPorSlug("infantil-e-brinquedos")?.numero).toBe(29);
  });

  it("ramoPorSlug devolve null para slug que não existe, vazio ou nulo", () => {
    expect(ramoPorSlug("inventado")).toBeNull();
    expect(ramoPorSlug("")).toBeNull();
    expect(ramoPorSlug(null)).toBeNull();
    expect(ramoPorSlug(undefined)).toBeNull();
  });
});
