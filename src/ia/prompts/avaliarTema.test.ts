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

    expect(sistema).toContain("já reprovou em roteiros");
    expect(sistema).toContain("- nao comparar preco com concorrente (firme)");
    expect(sistema).toContain("- nao mostrar rosto de cliente (fraca)");
  });
});
