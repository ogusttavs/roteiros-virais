import { describe, expect, it } from "vitest";

import type { Plataforma } from "@/db/schema";

import { resolverPlataformasReferencias } from "./pesquisa";

const SEM_VIDEO: Record<Plataforma, number> = { youtube: 0, tiktok: 0, instagram: 0 };

describe("resolverPlataformasReferencias", () => {
  it("sem parametro e sem rede principal: mostra todas", () => {
    expect(resolverPlataformasReferencias(undefined, null, SEM_VIDEO)).toEqual({ plataformas: [] });
  });

  it("sem parametro, rede principal com video no periodo: prefiltra por ela", () => {
    const contagem = { ...SEM_VIDEO, tiktok: 4 };
    expect(resolverPlataformasReferencias(undefined, "tiktok", contagem)).toEqual({ plataformas: ["tiktok"] });
  });

  /** Item 8, V12b: achado do Gustavo com a Dr.Wash no TikTok, coleta suspensa desde 09/09. */
  it("sem parametro, rede principal sem nenhum video no periodo: mostra todas e avisa qual rede ficou de fora", () => {
    expect(resolverPlataformasReferencias(undefined, "tiktok", SEM_VIDEO)).toEqual({
      plataformas: [],
      redePrincipalSemVideo: "tiktok",
    });
  });

  it("?plataforma=todas fecha o prefiltro de proposito, mesmo com rede principal e video", () => {
    const contagem = { ...SEM_VIDEO, tiktok: 4 };
    expect(resolverPlataformasReferencias("todas", "tiktok", contagem)).toEqual({ plataformas: [] });
  });

  it("parametro explicito de uma plataforma vence a rede principal", () => {
    const contagem = { ...SEM_VIDEO, tiktok: 4, youtube: 2 };
    expect(resolverPlataformasReferencias("youtube", "tiktok", contagem)).toEqual({ plataformas: ["youtube"] });
  });

  it("parametro explicito com mais de uma plataforma", () => {
    expect(resolverPlataformasReferencias("youtube,instagram", null, SEM_VIDEO)).toEqual({
      plataformas: ["youtube", "instagram"],
    });
  });

  it("parametro com valor invalido e filtrado fora, sem quebrar", () => {
    expect(resolverPlataformasReferencias("youtube,inexistente", null, SEM_VIDEO)).toEqual({
      plataformas: ["youtube"],
    });
  });
});
