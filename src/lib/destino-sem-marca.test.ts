import { describe, expect, it } from "vitest";

import { destinoDaSessao, destinoSemMarca, ROTA_SEM_MARCA } from "./destino-sem-marca";

describe("destinoSemMarca (sessao sem marca ativa)", () => {
  it("o cliente vai a tela propria, nunca a /entrar nem a /comecar (era o laco)", () => {
    expect(destinoSemMarca("cliente")).toBe(ROTA_SEM_MARCA);
    expect(destinoSemMarca("cliente")).not.toBe("/entrar");
    expect(destinoSemMarca("cliente")).not.toBe("/comecar");
  });

  it("o admin nunca cai na tela de conta sem marca: vai ao /admin", () => {
    expect(destinoSemMarca("admin")).toBe("/admin");
  });

  it("papel ausente ou desconhecido e tratado como cliente", () => {
    expect(destinoSemMarca(undefined)).toBe(ROTA_SEM_MARCA);
    expect(destinoSemMarca(null)).toBe(ROTA_SEM_MARCA);
    expect(destinoSemMarca("outro")).toBe(ROTA_SEM_MARCA);
  });
});

describe("destinoDaSessao (quem ja tem sessao abre /entrar)", () => {
  it("cliente com marca: nada muda, vai ao /hoje", () => {
    expect(destinoDaSessao("cliente", true)).toBe("/hoje");
  });

  it("cliente sem marca: vai a tela propria, que nao devolve para /hoje", () => {
    expect(destinoDaSessao("cliente", false)).toBe(ROTA_SEM_MARCA);
  });

  it("admin vai ao /admin com ou sem marca", () => {
    expect(destinoDaSessao("admin", true)).toBe("/admin");
    expect(destinoDaSessao("admin", false)).toBe("/admin");
  });

  it("o destino de quem nao tem marca nunca e uma rota que redireciona para /entrar (sem laco possivel)", () => {
    // Toda rota que decide sem marca devolve para a tela propria, e a tela propria so redireciona quando ha marca (/hoje) ou o papel e admin (/admin).
    const destinos = new Set([destinoSemMarca("cliente"), destinoDaSessao("cliente", false)]);
    expect([...destinos]).toEqual([ROTA_SEM_MARCA]);
  });
});
