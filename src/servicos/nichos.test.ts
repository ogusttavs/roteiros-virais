import { describe, expect, it } from "vitest";

import { analisarUrlPerfil, gerarSlug, normalizarTermos } from "./nichos";

describe("gerarSlug", () => {
  it("minusculo, sem acento, hifens no lugar de espaco", () => {
    expect(gerarSlug("Produtos de Limpeza")).toBe("produtos-de-limpeza");
  });

  it("remove acento", () => {
    expect(gerarSlug("Estética e Beleza")).toBe("estetica-e-beleza");
  });

  it("colapsa pontuacao em um hifen so e tira das pontas", () => {
    expect(gerarSlug("  Dentistas!! (SP) ")).toBe("dentistas-sp");
  });
});

describe("normalizarTermos", () => {
  it("um termo por linha, tira espaco das pontas", () => {
    expect(normalizarTermos("dentista\nortodontia\nclareamento")).toEqual([
      "dentista",
      "ortodontia",
      "clareamento",
    ]);
  });

  it("ignora linha em branco, nao conta como termo vazio", () => {
    expect(normalizarTermos("dentista\n\n\nortodontia\n")).toEqual(["dentista", "ortodontia"]);
  });

  it("sem repeticao ignorando caixa e acento, mantem a primeira grafia", () => {
    expect(normalizarTermos("Dentista\ndentista\nDENTISTA\ndéntista")).toEqual(["Dentista"]);
  });
});

describe("analisarUrlPerfil", () => {
  it("youtube com @handle", () => {
    expect(analisarUrlPerfil("https://www.youtube.com/@drwashoficial")).toEqual({
      plataforma: "youtube",
      handle: "@drwashoficial",
    });
  });

  it("youtube com /channel/<id>", () => {
    expect(analisarUrlPerfil("https://youtube.com/channel/UCabcdef0123456789")).toEqual({
      plataforma: "youtube",
      handle: "UCabcdef0123456789",
    });
  });

  it("tiktok com @handle, guarda sem o @ (mesmo formato de normalizadores/tiktok.ts)", () => {
    expect(analisarUrlPerfil("https://www.tiktok.com/@drwashoficial")).toEqual({
      plataforma: "tiktok",
      handle: "drwashoficial",
    });
  });

  it("instagram com o nome de usuario, guarda sem o @ (mesmo formato de normalizadores/instagram.ts)", () => {
    expect(analisarUrlPerfil("https://www.instagram.com/drwashoficial/")).toEqual({
      plataforma: "instagram",
      handle: "drwashoficial",
    });
  });

  it("aceita www. e m. na frente do dominio", () => {
    expect(analisarUrlPerfil("https://m.youtube.com/@drwashoficial")?.handle).toBe("@drwashoficial");
  });

  it("recusa video ou post, so perfil (mais de um segmento no caminho)", () => {
    expect(analisarUrlPerfil("https://www.tiktok.com/@drwashoficial/video/123456")).toBeNull();
    expect(analisarUrlPerfil("https://www.instagram.com/drwashoficial/reel/abc123/")).toBeNull();
  });

  it("recusa dominio que nao e das tres plataformas", () => {
    expect(analisarUrlPerfil("https://www.facebook.com/drwashoficial")).toBeNull();
  });

  it("recusa texto que nao e uma URL", () => {
    expect(analisarUrlPerfil("nao e uma url")).toBeNull();
  });
});
