import { describe, expect, it } from "vitest";

import { estadoDoPerfilAnalisado } from "./perfil-analisado-motivo";

const BASE = { leitura: null, existeNaRede: false, motivo: null, rede: "instagram" } as const;

describe("estadoDoPerfilAnalisado", () => {
  it("com leitura, mostra a leitura (e nunca um motivo)", () => {
    expect(estadoDoPerfilAnalisado({ ...BASE, leitura: "Posta antes e depois.", existeNaRede: true })).toEqual({ tipo: "leitura" });
  });

  it("existe na rede e ainda sem leitura: está lendo", () => {
    expect(estadoDoPerfilAnalisado({ ...BASE, existeNaRede: true })).toEqual({ tipo: "lendo" });
  });

  it("usa o motivo gravado", () => {
    for (const motivo of ["tiktok_desligado", "nao_encontrado", "sem_videos", "conta_restrita"] as const) {
      expect(estadoDoPerfilAnalisado({ ...BASE, motivo })).toEqual({ tipo: "sem_leitura", motivo });
    }
  });

  it("linha antiga (motivo nulo): TikTok é desligado, o resto é @ não encontrado", () => {
    expect(estadoDoPerfilAnalisado({ ...BASE, rede: "tiktok" })).toEqual({ tipo: "sem_leitura", motivo: "tiktok_desligado" });
    expect(estadoDoPerfilAnalisado({ ...BASE, rede: "instagram" })).toEqual({ tipo: "sem_leitura", motivo: "nao_encontrado" });
    expect(estadoDoPerfilAnalisado({ ...BASE, rede: "youtube" })).toEqual({ tipo: "sem_leitura", motivo: "nao_encontrado" });
  });

  it("o motivo gravado vale mais que a rede (Instagram restrito não vira 'não encontrado')", () => {
    expect(estadoDoPerfilAnalisado({ ...BASE, rede: "instagram", motivo: "conta_restrita" })).toEqual({
      tipo: "sem_leitura",
      motivo: "conta_restrita",
    });
  });

  it("linha antiga com a frase do PR 1: cada frase conhecida vira o motivo certo (a conta pessoal não vira '@ errado')", () => {
    const antigas = [
      ["instagram", "perfil pessoal ou com restricao de idade.", "conta_restrita"],
      ["youtube", "o canal nao tem video publicado.", "sem_videos"],
      ["tiktok", "TikTok fora do ar por enquanto (Apify suspenso).", "tiktok_desligado"],
      ["instagram", "perfil nao encontrado na rede.", "nao_encontrado"],
    ] as const;
    for (const [rede, erro, motivo] of antigas) {
      expect(estadoDoPerfilAnalisado({ ...BASE, rede, erro })).toEqual({ tipo: "sem_leitura", motivo });
    }
  });

  it("frase antiga desconhecida cai no padrão da rede, e o motivo gravado vale mais que a frase", () => {
    expect(estadoDoPerfilAnalisado({ ...BASE, erro: "alguma frase que ninguém mapeou" })).toEqual({ tipo: "sem_leitura", motivo: "nao_encontrado" });
    expect(estadoDoPerfilAnalisado({ ...BASE, motivo: "sem_videos", erro: "perfil pessoal ou com restricao de idade." })).toEqual({
      tipo: "sem_leitura",
      motivo: "sem_videos",
    });
  });
});
