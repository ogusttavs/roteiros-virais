/** A busca e os filtros da lista de Contas (E46 PR 1): sem acento, por conta, por ramo, por nome ou e-mail da pessoa. */
import { describe, expect, it } from "vitest";

import type { ContaAdmin } from "@/servicos/admin-contas";

import { casaComABusca, noFiltro, normalizar } from "./busca-contas";

const conta = (parcial: Partial<ContaAdmin>) =>
  ({
    id: 1,
    nome: "Clínica Sorriso Claro",
    ramoNome: "Dentistas",
    quemTemAcesso: [{ usuarioId: "u1", nome: "Ana Prado", email: "ana@sorrisoclaro.com.br", papel: "dono", ultimoAcessoEm: null }],
    usando: false,
    parou: false,
    nuncaEntrou: false,
    ...parcial,
  }) as ContaAdmin;

describe("normalizar", () => {
  it("tira acento e maiúscula", () => {
    expect(normalizar("  Clínica ÁGUA ")).toBe("clinica agua");
  });
});

describe("casaComABusca", () => {
  it("acha pelo nome da conta sem acento", () => {
    expect(casaComABusca(conta({}), "clinica")).toBe(true);
  });

  it("acha pelo ramo, pelo nome da pessoa e pelo e-mail dela", () => {
    expect(casaComABusca(conta({}), "dentist")).toBe(true);
    expect(casaComABusca(conta({}), "ana pra")).toBe(true);
    expect(casaComABusca(conta({}), "sorrisoclaro.com")).toBe(true);
  });

  it("não acha o que não existe", () => {
    expect(casaComABusca(conta({}), "clinica estrela")).toBe(false);
  });

  it("busca vazia deixa tudo", () => {
    expect(casaComABusca(conta({}), "   ")).toBe(true);
  });
});

describe("noFiltro", () => {
  it("cada filtro olha o seu campo", () => {
    expect(noFiltro(conta({ usando: true }), "usando")).toBe(true);
    expect(noFiltro(conta({ parou: true }), "parou")).toBe(true);
    expect(noFiltro(conta({ nuncaEntrou: true }), "nao_entrou")).toBe(true);
    expect(noFiltro(conta({}), "usando")).toBe(false);
    expect(noFiltro(conta({}), "todas")).toBe(true);
  });
});
