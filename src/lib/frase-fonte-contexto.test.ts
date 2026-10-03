import { describe, expect, it } from "vitest";

import { encontrarProblemas } from "@/lib/regras-de-texto";

import { fraseDaFonteNaoLida } from "./frase-fonte-contexto";

describe("fraseDaFonteNaoLida", () => {
  it("fonte lida e TikTok não geram frase (o TikTok tem a sua própria na seção)", () => {
    expect(fraseDaFonteNaoLida({ tipo: "site", lida: true, quantidade: 3 })).toBeNull();
    expect(fraseDaFonteNaoLida({ tipo: "tiktok", lida: false, motivo: "desligado" })).toBeNull();
  });

  it("site: uma frase por motivo, e uma de reserva para motivo desconhecido", () => {
    expect(fraseDaFonteNaoLida({ tipo: "site", lida: false, motivo: "sem_texto" })).toContain("não conseguimos pegar o texto dele");
    expect(fraseDaFonteNaoLida({ tipo: "site", lida: false, motivo: "robots_proibe" })).toContain("pede que robôs não leiam");
    expect(fraseDaFonteNaoLida({ tipo: "site", lida: false, motivo: "rede_social" })).toContain("rede social");
    expect(fraseDaFonteNaoLida({ tipo: "site", lida: false, motivo: "inventado" })).toBe("Site: não deu para ler.");
    expect(fraseDaFonteNaoLida({ tipo: "site", lida: false })).toBe("Site: não deu para ler.");
  });

  it("rede: o nome da rede entra na frase", () => {
    // O código 110 da Meta serve ao @ que não existe e à conta pessoal: a frase cobre os dois, sem acusar só um.
    const restrita = fraseDaFonteNaoLida({ tipo: "instagram", lida: false, motivo: "conta_restrita" }) ?? "";
    expect(restrita).toContain("Instagram: ");
    expect(restrita).toContain("Confira o @");
    expect(restrita).toContain("conta profissional");
    expect(fraseDaFonteNaoLida({ tipo: "youtube", lida: false, motivo: "sem_videos" })).toBe(
      "YouTube: ainda não tem vídeo publicado para a gente ler.",
    );
    expect(fraseDaFonteNaoLida({ tipo: "youtube", lida: false, motivo: "x" })).toBe("YouTube: não deu para ler.");
  });

  it("nenhuma frase tem travessão, emoji nem jargão", () => {
    const motivosDeSite = ["endereco_invalido", "rede_social", "robots_proibe", "erro_do_site", "bloqueado_pelo_site", "nao_encontrado", "grande_demais", "sem_texto"];
    const motivosDeRede = ["nao_encontrado", "sem_videos", "conta_restrita", "desligada", "indisponivel"];
    for (const motivo of motivosDeSite) expect(encontrarProblemas(fraseDaFonteNaoLida({ tipo: "site", lida: false, motivo }) ?? "")).toEqual([]);
    for (const motivo of motivosDeRede) expect(encontrarProblemas(fraseDaFonteNaoLida({ tipo: "instagram", lida: false, motivo }) ?? "")).toEqual([]);
  });
});
