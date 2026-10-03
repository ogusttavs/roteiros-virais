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
});
