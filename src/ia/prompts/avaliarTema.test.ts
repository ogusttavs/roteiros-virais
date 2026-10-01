/**
 * E27, parte 2, item 3: `montarSistemaEstavel` ganha `regrasCliente`. Sem
 * nenhuma regra o bloco nao aparece; com regra, aparece com o rotulo firme
 * (contagem >= 2) ou fraca (contagem 1).
 */
import { describe, expect, it } from "vitest";

import { montarSistemaEstavel } from "./avaliarTema";

const BASE = {
  perfilCompilado: "perfil do cliente",
  modeloNicho: "modelo do nicho",
  persona: "negocio" as const,
};

describe("montarSistemaEstavel", () => {
  it("sem regrasCliente, nao monta o bloco da memoria", () => {
    const sistema = montarSistemaEstavel({ ...BASE, regrasCliente: [] });
    expect(sistema).not.toContain("já reprovou em roteiros");
  });

  it("com regrasCliente, lista cada regra com firme (contagem >= 2) ou fraca (contagem 1)", () => {
    const sistema = montarSistemaEstavel({
      ...BASE,
      regrasCliente: [
        { regra: "nao comparar preco com concorrente", contagem: 3 },
        { regra: "nao mostrar rosto de cliente", contagem: 1 },
      ],
    });

    expect(sistema).toContain("já reprovou em roteiros (a firme vale como proibição dele, encaixe 4 ou menos; a fraca pesa contra)");
    expect(sistema).toContain("- nao comparar preco com concorrente (firme)");
    expect(sistema).toContain("- nao mostrar rosto de cliente (fraca)");
  });

  // V12c, item 2, a E37b: "conhecido" vira persona tambem para quem vende, nao so para pessoa.
  it('persona "conhecido": o contexto e o pilar "gerar cliente" falam de ser procurado, nao de comprar', () => {
    const sistema = montarSistemaEstavel({ ...BASE, regrasCliente: [], persona: "conhecido" });
    expect(sistema).toContain("Este cliente quer ficar conhecido no que faz");
    expect(sistema).toContain("Para quem escolheu ficar conhecido,");
    expect(sistema).toContain("gerar cliente significa fazer a pessoa ser procurada, seguida ou indicada");
  });

  it('persona "negocios": o contexto fala em levar gente para os proprios negocios', () => {
    const sistema = montarSistemaEstavel({ ...BASE, regrasCliente: [], persona: "negocios" });
    expect(sistema).toContain("Este cliente quer levar gente para os próprios negócios");
  });
});
