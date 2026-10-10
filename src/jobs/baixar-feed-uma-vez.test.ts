import { describe, expect, it } from "vitest";

import { baixarFeedUmaVezPorRodada } from "./coleta-assuntos";

describe("baixarFeedUmaVezPorRodada: o mesmo feed não é baixado duas vezes na rodada", () => {
  it("o mesmo endereço baixa uma vez, mesmo com pedidos ao mesmo tempo; outro endereço baixa à parte", async () => {
    const baixados: string[] = [];
    const baixar = baixarFeedUmaVezPorRodada(async (url) => {
      baixados.push(url);
      return `<rss>${url}</rss>`;
    });
    const [a, b] = await Promise.all([baixar("https://g1.globo.com/rss"), baixar("https://g1.globo.com/rss")]);
    expect(a).toBe(b);
    expect(await baixar("https://g1.globo.com/rss")).toBe(a);
    await baixar("https://exame.com/feed/");
    expect(baixados).toEqual(["https://g1.globo.com/rss", "https://exame.com/feed/"]);
  });

  it("a falha também é lembrada: o feed que não respondeu não espera o prazo de novo", async () => {
    let chamadas = 0;
    const baixar = baixarFeedUmaVezPorRodada(async () => {
      chamadas += 1;
      throw new Error("o feed respondeu 503");
    });
    await expect(baixar("https://uol.com.br/feed")).rejects.toThrow("503");
    await expect(baixar("https://uol.com.br/feed")).rejects.toThrow("503");
    expect(chamadas).toBe(1);
  });

  it("cada rodada começa do zero: uma função nova não lembra o que a outra baixou", async () => {
    let chamadas = 0;
    const baixarFeed = async () => {
      chamadas += 1;
      return "<rss/>";
    };
    await baixarFeedUmaVezPorRodada(baixarFeed)("https://g1.globo.com/rss");
    await baixarFeedUmaVezPorRodada(baixarFeed)("https://g1.globo.com/rss");
    expect(chamadas).toBe(2);
  });
});
