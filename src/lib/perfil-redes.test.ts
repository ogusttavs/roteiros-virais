import { describe, expect, it } from "vitest";

import { comArroba, limparCampoPerfil, perfilPareceValido, semBarrasNoFim, TAMANHO_MAXIMO_DO_CAMPO_DE_PERFIL } from "./perfil-redes";

describe("comArroba", () => {
  it("Instagram e TikTok guardam sem arroba: ganha um", () => {
    expect(comArroba("drwash")).toBe("@drwash");
  });

  it("YouTube já vem com arroba: nunca vira dois (o bug do @@canal do PR 1)", () => {
    expect(comArroba("@canalexemplo")).toBe("@canalexemplo");
  });
});

describe("limparCampoPerfil", () => {
  it("instagram: endereco inteiro vira so o nome", () => {
    expect(limparCampoPerfil("https://www.instagram.com/drwash/?hl=pt", "instagram")).toBe("drwash");
  });

  it("instagram: com arroba, sem arroba, com espaco", () => {
    expect(limparCampoPerfil("@drwash", "instagram")).toBe("drwash");
    expect(limparCampoPerfil("drwash", "instagram")).toBe("drwash");
    expect(limparCampoPerfil("  drwash  ", "instagram")).toBe("drwash");
  });

  it("tiktok: endereco inteiro com @ no path vira so o nome, sem arroba", () => {
    expect(limparCampoPerfil("https://www.tiktok.com/@drwash", "tiktok")).toBe("drwash");
  });

  it("youtube: guarda com arroba, mesmo colando so o nome", () => {
    expect(limparCampoPerfil("drwash", "youtube")).toBe("@drwash");
    expect(limparCampoPerfil("https://www.youtube.com/@drwash", "youtube")).toBe("@drwash");
  });

  it("link de outra plataforma no campo errado: trata como texto solto, nao extrai", () => {
    // colou o link do instagram no campo do tiktok: nao e um link de tiktok.com, vira texto bruto.
    const resultado = limparCampoPerfil("https://www.instagram.com/drwash", "tiktok");
    expect(resultado).not.toBe("drwash");
  });

  it("barra no fim sai", () => {
    expect(limparCampoPerfil("drwash/", "instagram")).toBe("drwash");
  });

  it("campo vazio ou so espaco vira vazio", () => {
    expect(limparCampoPerfil("", "instagram")).toBe("");
    expect(limparCampoPerfil("   ", "instagram")).toBe("");
  });
});

describe("perfilPareceValido", () => {
  it("aceita letras, numeros, ponto, underscore e hifen", () => {
    expect(perfilPareceValido("dr.wash_oficial-2")).toBe(true);
  });

  it("vazio conta como valido (campo opcional, sem erro antes de digitar)", () => {
    expect(perfilPareceValido("")).toBe(true);
  });

  it("recusa espaco e caractere que a plataforma nao aceita", () => {
    expect(perfilPareceValido("dr wash")).toBe(false);
    expect(perfilPareceValido("dr@wash")).toBe(false);
    expect(perfilPareceValido("dr/wash")).toBe(false);
  });
});

describe("limparCampoPerfil: o campo chega do servidor sem teto, então a limpeza não pode ser quadrática nem aceitar texto enorme", () => {
  it("uma linha de barras com um caractere no fim não trava (a regex de barra no fim era quadrática)", () => {
    const comeco = performance.now();
    expect(limparCampoPerfil(`${"/".repeat(250)}x`, "instagram")).toBe(`${"/".repeat(250)}x`.replace(/^@+/, ""));
    expect(limparCampoPerfil("/".repeat(200_000), "instagram")).toBe("");
    expect(performance.now() - comeco).toBeLessThan(1_000);
  });

  it("acima de 300 caracteres devolve vazio (nenhum perfil de verdade chega perto)", () => {
    expect(limparCampoPerfil("a".repeat(TAMANHO_MAXIMO_DO_CAMPO_DE_PERFIL), "instagram")).toBe("a".repeat(TAMANHO_MAXIMO_DO_CAMPO_DE_PERFIL));
    expect(limparCampoPerfil("a".repeat(TAMANHO_MAXIMO_DO_CAMPO_DE_PERFIL + 1), "instagram")).toBe("");
  });
});

describe("semBarrasNoFim", () => {
  it("tira só as do fim", () => {
    expect(semBarrasNoFim("perfil///")).toBe("perfil");
    expect(semBarrasNoFim("a/b/")).toBe("a/b");
    expect(semBarrasNoFim("///")).toBe("");
    expect(semBarrasNoFim("")).toBe("");
    expect(semBarrasNoFim("sem barra")).toBe("sem barra");
  });
});
