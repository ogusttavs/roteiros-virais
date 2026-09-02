import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { TiktokItemBruto } from "@/jobs/apify-api";

import { normalizarVideoTiktok } from "./tiktok";

function carregarFixture(): TiktokItemBruto[] {
  const caminho = path.resolve(process.cwd(), "tests/fixtures/coleta/tiktok-itens.json");
  return JSON.parse(readFileSync(caminho, "utf8")) as TiktokItemBruto[];
}

describe("normalizarVideoTiktok", () => {
  const itens = carregarFixture();

  it("normaliza o primeiro item, com audio e todas as estatisticas", () => {
    const { video, conta, audio } = normalizarVideoTiktok(itens[0]);

    expect(video).toEqual({
      plataforma: "tiktok",
      idExterno: "7345678901234567890",
      url: "https://www.tiktok.com/@exemplo.sorrisoemdia/video/7345678901234567890",
      titulo: null,
      descricao: "[exemplo] 3 erros que estragam o seu sorriso #dentista",
      publicadoEm: new Date("2026-08-21T10:00:00.000Z"),
      duracaoS: 34,
      views: 245310,
      likes: 18320,
      comentarios: 421,
    });
    expect(conta).toEqual({
      plataforma: "tiktok",
      handle: "exemplo.sorrisoemdia",
      nome: "[exemplo] Sorriso em Dia",
      url: "https://www.tiktok.com/@exemplo.sorrisoemdia",
    });
    expect(audio).toEqual({
      id: "7111111111111111111",
      nome: "[exemplo] som original",
      autor: "exemplo.sorrisoemdia",
      original: true,
    });
  });

  it("sem musicMeta, o audio vem nulo e as estatisticas ausentes viram zero", () => {
    const { video, audio } = normalizarVideoTiktok(itens[1]);

    expect(audio).toBeNull();
    expect(video.likes).toBe(0);
    expect(video.comentarios).toBe(0);
    expect(video.views).toBe(58210);
  });
});
