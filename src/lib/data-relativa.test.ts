import { describe, expect, it } from "vitest";

import { ErroDataRelativa, resolverDataRelativa } from "./data-relativa";

// Quarta-feira, 23/09/2026 (confere: new Date("2026-09-23").getUTCDay() === 3).
const HOJE = "2026-09-23";

describe("resolverDataRelativa", () => {
  it("hoje devolve a propria data de hoje", () => {
    expect(resolverDataRelativa("hoje", HOJE)).toBe("2026-09-23");
  });

  it("amanha devolve o dia seguinte", () => {
    expect(resolverDataRelativa("amanha", HOJE)).toBe("2026-09-24");
    expect(resolverDataRelativa("amanhã", HOJE)).toBe("2026-09-24");
  });

  it("depois de amanha devolve dois dias a frente (achado do golden set da agenda, item 5)", () => {
    expect(resolverDataRelativa("depois de amanha", HOJE)).toBe("2026-09-25");
    expect(resolverDataRelativa("depois de amanhã", HOJE)).toBe("2026-09-25");
  });

  it("o mesmo dia da semana de hoje volta hoje, nao a semana que vem", () => {
    expect(resolverDataRelativa("quarta", HOJE)).toBe("2026-09-23");
  });

  it("um dia da semana que ja passou nesta semana volta na proxima ocorrencia", () => {
    // segunda (1) ja passou (hoje e quarta, 3): a proxima segunda e 28/09.
    expect(resolverDataRelativa("segunda", HOJE)).toBe("2026-09-28");
  });

  it("um dia da semana que ainda vai chegar nesta semana volta nele mesmo", () => {
    // sexta (5) ainda nao chegou (hoje e quarta, 3): 25/09.
    expect(resolverDataRelativa("sexta", HOJE)).toBe("2026-09-25");
  });

  it("aceita nomes de dia sem acento e maiusculo, com espaco nas pontas", () => {
    expect(resolverDataRelativa(" Sábado ", HOJE)).toBe("2026-09-26");
  });

  it("aceita a forma cheia do dia da semana, com ou sem hifen (achado do golden set da agenda, item 5: o modelo real prefere essa forma)", () => {
    expect(resolverDataRelativa("segunda-feira", HOJE)).toBe("2026-09-28");
    expect(resolverDataRelativa("Terça-feira", HOJE)).toBe("2026-09-29");
    expect(resolverDataRelativa("sexta feira", HOJE)).toBe("2026-09-25");
  });

  it("dia N no futuro dentro do mes atual", () => {
    expect(resolverDataRelativa("dia 30", HOJE)).toBe("2026-09-30");
  });

  it("dia N que ja passou neste mes vai para o mes seguinte", () => {
    expect(resolverDataRelativa("dia 3", HOJE)).toBe("2026-10-03");
  });

  it("dia N igual a hoje conta como este mes, nao o proximo", () => {
    expect(resolverDataRelativa("dia 23", HOJE)).toBe("2026-09-23");
  });

  it("dia N que nao existe no mes candidato: erro, nunca rola sozinho para o mes seguinte", () => {
    // Hoje e 23/09; "dia 31" ja passaria para outubro (que tem 31, entao passa),
    // mas fevereiro nao tem 30: forcamos esse caso com uma data de hoje diferente.
    expect(() => resolverDataRelativa("dia 30", "2026-02-15")).toThrow(ErroDataRelativa);
  });

  it("dia do mes fora de 1 a 31: erro", () => {
    expect(() => resolverDataRelativa("dia 32", HOJE)).toThrow(ErroDataRelativa);
    expect(() => resolverDataRelativa("dia 0", HOJE)).toThrow(ErroDataRelativa);
  });

  it("referencia nao reconhecida: erro nomeado, para o chamador descartar o dia em vez de inventar", () => {
    expect(() => resolverDataRelativa("semana que vem", HOJE)).toThrow(ErroDataRelativa);
    expect(() => resolverDataRelativa("", HOJE)).toThrow(ErroDataRelativa);
  });
});
