import { describe, expect, it } from "vitest";

import { pedidoDaIlustracao } from "./pedido-de-ilustracao";

const base = { texto: "O aparelho segura placa\nBraquete e fio criam cantos", tema: "limpeza com aparelho", ramo: "Odontologia", arquivo: "slide-02.png" };

describe("pedidoDaIlustracao", () => {
  it("monta o pedido do assunto: motivo unico, foto de celular, area calma e as proibicoes", () => {
    const p = pedidoDaIlustracao({ ...base, tipo: "item" });
    expect(p?.generica).toBe(false);
    expect(p?.prompt).toContain("slide-02.png");
    expect(p?.prompt).toContain("UM objeto ou cena concreta");
    expect(p?.prompt).toContain("O aparelho segura placa / Braquete e fio criam cantos");
    expect(p?.prompt).toMatch(/foto de celular/);
    expect(p?.prompt).toMatch(/luz de janela/);
    expect(p?.prompt).toMatch(/area calma/);
    expect(p?.prompt).toMatch(/PROIBIDO: pessoa real conhecida/);
    expect(p?.prompt).toMatch(/texto, letra, numero, logotipo ou marca/);
    expect(p?.prompt).toMatch(/transparente, de vidro ou muito escuro/);
  });

  it("generico so no resumo e na chamada, e sem o texto do slide", () => {
    for (const tipo of ["resumo", "chamada"]) {
      const p = pedidoDaIlustracao({ ...base, tipo });
      expect(p?.generica).toBe(true);
      expect(p?.prompt).toContain("GENERICA");
      expect(p?.prompt).not.toContain("Braquete");
    }
    for (const tipo of ["item", "passo", "capa-texto", "dado"]) expect(pedidoDaIlustracao({ ...base, tipo })?.generica).toBe(false);
  });

  it("antes e depois, resultado e noticia (pessoa real conhecida) nao recebem pedido", () => {
    for (const tipo of ["antes-depois", "prova-resultado", "noticia"]) expect(pedidoDaIlustracao({ ...base, tipo })).toBeNull();
  });

  it("sem travessao nem emoji no texto do pedido", () => {
    const p = pedidoDaIlustracao({ ...base, tipo: "item" });
    expect(p?.prompt).not.toMatch(/[–—]/);
    expect(p?.prompt).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
