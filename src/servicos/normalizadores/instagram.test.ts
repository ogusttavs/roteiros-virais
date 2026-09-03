import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { InstagramItemBruto } from "@/jobs/apify-api";

import { normalizarVideoInstagram } from "./instagram";

function carregarFixture(): InstagramItemBruto[] {
  const caminho = path.resolve(process.cwd(), "tests/fixtures/coleta/instagram-itens.json");
  return JSON.parse(readFileSync(caminho, "utf8")) as InstagramItemBruto[];
}

describe("normalizarVideoInstagram", () => {
  const itens = carregarFixture();

  it("normaliza o primeiro item, com audio e todas as estatisticas", () => {
    const { video, conta, audio } = normalizarVideoInstagram(itens[0]);

    expect(video).toEqual({
      plataforma: "instagram",
      idExterno: "Cx1Exemplo01",
      url: "https://www.instagram.com/reel/Cx1Exemplo01/",
      titulo: null,
      descricao: "[exemplo] 3 erros que estragam o seu sorriso",
      publicadoEm: new Date("2026-08-21T10:00:00.000Z"),
      duracaoS: 34,
      views: 132045,
      likes: 9210,
      comentarios: 187,
    });
    expect(conta).toEqual({
      plataforma: "instagram",
      handle: "exemplo.sorrisoemdia",
      nome: "[exemplo] Sorriso em Dia",
      url: "https://www.instagram.com/exemplo.sorrisoemdia",
    });
    expect(audio).toEqual({
      id: "611111111111111",
      nome: "[exemplo] som original",
      autor: "exemplo.sorrisoemdia",
      original: true,
    });
  });

  it("sem musicInfo, o audio vem nulo; usa videoViewCount quando nao ha videoPlayCount", () => {
    const { video, audio } = normalizarVideoInstagram(itens[1]);

    expect(audio).toBeNull();
    expect(video.likes).toBe(0);
    expect(video.comentarios).toBe(0);
    expect(video.duracaoS).toBeNull();
    expect(video.views).toBe(40210);
  });
});
