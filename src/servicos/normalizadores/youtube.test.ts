import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { YoutubeVideosResponse } from "@/jobs/youtube-api";

import { normalizarVideoYoutube, parseDuracaoIso8601 } from "./youtube";

function carregarFixture(): YoutubeVideosResponse {
  const caminho = path.resolve(process.cwd(), "tests/fixtures/coleta/youtube-videos-list.json");
  return JSON.parse(readFileSync(caminho, "utf8")) as YoutubeVideosResponse;
}

describe("parseDuracaoIso8601", () => {
  it("converte so segundos", () => {
    expect(parseDuracaoIso8601("PT47S")).toBe(47);
  });

  it("converte minutos e segundos", () => {
    expect(parseDuracaoIso8601("PT1M12S")).toBe(72);
  });

  it("converte horas, minutos e segundos", () => {
    expect(parseDuracaoIso8601("PT1H2M3S")).toBe(3723);
  });

  it("devolve nulo para um formato que nao bate", () => {
    expect(parseDuracaoIso8601("nao e duracao")).toBeNull();
  });
});

describe("normalizarVideoYoutube", () => {
  const fixture = carregarFixture();
  const itens = fixture.items ?? [];

  it("normaliza o primeiro item da fixture, com todas as estatisticas", () => {
    const { video, conta } = normalizarVideoYoutube(itens[0]);

    expect(video).toEqual({
      plataforma: "youtube",
      idExterno: "exVid00000a",
      url: "https://www.youtube.com/watch?v=exVid00000a",
      titulo: "[exemplo] 3 erros que estragam o seu sorriso",
      descricao: "[exemplo] video ficticio de teste sobre cuidados com os dentes.",
      publicadoEm: new Date("2026-08-20T14:00:00Z"),
      duracaoS: 47,
      views: 182345,
      likes: 9021,
      comentarios: 312,
      idioma: "pt",
      capaUrl: "https://i.ytimg.com/vi/exVid00000a/hqdefault.jpg",
    });
    expect(conta).toEqual({
      plataforma: "youtube",
      handle: "UCexemplo00000000001",
      nome: "[exemplo] Sorriso em Dia",
      url: "https://www.youtube.com/channel/UCexemplo00000000001",
      // `videos.list` nunca traz subscriberCount; quem preenche e coleta-youtube.ts (item 4).
      seguidores: null,
    });
  });

  it("estatisticas ausentes (likes e comentarios desligados) viram zero, nunca NaN", () => {
    const { video } = normalizarVideoYoutube(itens[1]);

    expect(video.likes).toBe(0);
    expect(video.comentarios).toBe(0);
    expect(video.views).toBe(54210);
  });

  /** V2b, item 2: defaultAudioLanguage/defaultLanguage do video mandam sobre a deteccao por titulo/descricao. */
  function itemComIdioma(campos: { defaultAudioLanguage?: string; defaultLanguage?: string; title?: string; description?: string }) {
    return {
      id: "exVidIdioma",
      snippet: {
        channelId: "UCexemplo",
        channelTitle: "Canal exemplo",
        title: campos.title ?? "titulo generico",
        description: campos.description ?? "descricao generica",
        publishedAt: "2026-08-20T14:00:00Z",
        defaultAudioLanguage: campos.defaultAudioLanguage,
        defaultLanguage: campos.defaultLanguage,
      },
      contentDetails: { duration: "PT30S" },
      statistics: { viewCount: "100", likeCount: "1", commentCount: "0" },
    };
  }

  it("defaultAudioLanguage manda, mesmo com titulo em outro idioma", () => {
    const { video } = normalizarVideoYoutube(itemComIdioma({ defaultAudioLanguage: "en-US", title: "você não vai acreditar" }));
    expect(video.idioma).toBe("en");
  });

  it("sem defaultAudioLanguage, defaultLanguage manda", () => {
    const { video } = normalizarVideoYoutube(itemComIdioma({ defaultLanguage: "es-419", title: "você não vai acreditar" }));
    expect(video.idioma).toBe("es");
  });

  it("sem nenhum codigo de idioma, cai na deteccao por titulo mais descricao", () => {
    const { video } = normalizarVideoYoutube(itemComIdioma({ title: "você não vai acreditar no que aconteceu" }));
    expect(video.idioma).toBe("pt");
  });

  it("codigo de idioma que nao e pt/en/es vira outro (ex.: japones)", () => {
    const { video } = normalizarVideoYoutube(itemComIdioma({ defaultAudioLanguage: "ja" }));
    expect(video.idioma).toBe("outro");
  });

  // V9d, item 0b, sub-item 4: a capa monta por codigo, sem chamada nova.
  it("capaUrl monta pelo id do video, sempre no formato hqdefault", () => {
    const { video } = normalizarVideoYoutube(itens[0]);
    expect(video.capaUrl).toBe("https://i.ytimg.com/vi/exVid00000a/hqdefault.jpg");
  });
});
