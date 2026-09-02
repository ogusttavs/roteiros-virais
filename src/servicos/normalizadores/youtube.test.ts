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

  it("normaliza o primeiro item da fixture, com todas as estatisticas", () => {
    const { video, conta } = normalizarVideoYoutube(fixture.items[0]);

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
    });
    expect(conta).toEqual({
      plataforma: "youtube",
      handle: "UCexemplo00000000001",
      nome: "[exemplo] Sorriso em Dia",
      url: "https://www.youtube.com/channel/UCexemplo00000000001",
    });
  });

  it("estatisticas ausentes (likes e comentarios desligados) viram zero, nunca NaN", () => {
    const { video } = normalizarVideoYoutube(fixture.items[1]);

    expect(video.likes).toBe(0);
    expect(video.comentarios).toBe(0);
    expect(video.views).toBe(54210);
  });
});
