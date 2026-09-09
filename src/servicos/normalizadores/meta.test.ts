import { describe, expect, it } from "vitest";

import { idExternoDoPermalink, normalizarBusinessDiscovery } from "./meta";

describe("idExternoDoPermalink", () => {
  it("extrai o codigo de um permalink de post", () => {
    expect(idExternoDoPermalink("https://www.instagram.com/p/Cx1Exemplo01/", "999")).toBe("Cx1Exemplo01");
  });

  it("extrai o codigo de um permalink de reel", () => {
    expect(idExternoDoPermalink("https://www.instagram.com/reel/Cx1Exemplo02/", "999")).toBe("Cx1Exemplo02");
  });

  it("sem permalink, usa o id numerico", () => {
    expect(idExternoDoPermalink(undefined, "999")).toBe("999");
  });

  it("permalink que nao bate no formato esperado, usa o id numerico", () => {
    expect(idExternoDoPermalink("https://www.instagram.com/exemplo.conta/", "999")).toBe("999");
  });
});

describe("normalizarBusinessDiscovery", () => {
  it("normaliza o perfil e os posts, com os campos confirmados em 08/09/2026 (acessos/meta-app.md)", () => {
    const resultado = normalizarBusinessDiscovery("natgeo", {
      username: "natgeo",
      followers_count: 268602293,
      media_count: 31995,
      media: {
        data: [
          {
            id: "111",
            media_type: "VIDEO",
            timestamp: "2026-08-20T10:00:00.000Z",
            view_count: 679098,
            like_count: 12000,
            comments_count: 300,
            permalink: "https://www.instagram.com/p/Cx1Exemplo01/",
            caption: "[exemplo] legenda do post",
          },
        ],
      },
    });

    expect(resultado.conta).toEqual({
      plataforma: "instagram",
      handle: "natgeo",
      nome: "natgeo",
      url: "https://www.instagram.com/natgeo",
      seguidores: 268602293,
    });
    expect(resultado.videos).toEqual([
      {
        plataforma: "instagram",
        idExterno: "Cx1Exemplo01",
        url: "https://www.instagram.com/p/Cx1Exemplo01/",
        titulo: "[exemplo] legenda do post",
        descricao: "[exemplo] legenda do post",
        publicadoEm: new Date("2026-08-20T10:00:00.000Z"),
        duracaoS: null,
        views: 679098,
        likes: 12000,
        comentarios: 300,
      },
    ]);
  });

  it("filtra fora um item que nao e video nem reel (ex: foto ou carrossel)", () => {
    const resultado = normalizarBusinessDiscovery("conta-exemplo", {
      username: "conta-exemplo",
      media: {
        data: [
          { id: "1", media_type: "VIDEO" },
          { id: "2", media_type: "IMAGE" },
          { id: "3", media_type: "CAROUSEL_ALBUM", media_product_type: "REELS" },
        ],
      },
    });
    expect(resultado.videos.map((v) => v.idExterno)).toEqual(["1", "3"]);
  });

  it("sem seguidores nem media, ainda normaliza a conta com seguidores nulo e lista de videos vazia", () => {
    const resultado = normalizarBusinessDiscovery("conta-vazia", { username: "conta-vazia" });
    expect(resultado.conta.seguidores).toBeNull();
    expect(resultado.videos).toEqual([]);
  });

  it("sem descricao, o titulo cai no fallback de tituloDeVideo", () => {
    const resultado = normalizarBusinessDiscovery("conta-sem-legenda", {
      username: "conta-sem-legenda",
      media: { data: [{ id: "1", media_type: "VIDEO", timestamp: "2026-09-05T12:00:00.000Z" }] },
    });
    expect(resultado.videos[0].titulo).toBe("vídeo de @conta-sem-legenda, 5 de setembro");
  });
});
