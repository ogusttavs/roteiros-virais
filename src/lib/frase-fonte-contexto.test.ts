import { describe, expect, it } from "vitest";

import { encontrarProblemas } from "@/lib/regras-de-texto";
import { textosBriefing } from "@/textos/briefing";

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

  // Todo motivo do leitor de site (o `satisfies` em `textos/briefing.ts` garante que não falta nenhum) tem frase própria, que não é a de reserva.
  const MOTIVOS_DE_SITE = Object.keys(textosBriefing.contextoDaMarca.naoLida.site);
  const MOTIVOS_DE_REDE = Object.keys(textosBriefing.contextoDaMarca.naoLida.rede);

  it("o leitor tem 15 motivos e cada um tem frase própria", () => {
    expect(MOTIVOS_DE_SITE).toHaveLength(15);
  });

  it.each(MOTIVOS_DE_SITE)("site, motivo %s: frase própria, sem travessão, emoji nem jargão", (motivo) => {
    const frase = fraseDaFonteNaoLida({ tipo: "site", lida: false, motivo }) ?? "";
    expect(frase).not.toBe(textosBriefing.contextoDaMarca.naoLida.padraoSite);
    expect(frase.startsWith("Site: ")).toBe(true);
    expect(encontrarProblemas(frase)).toEqual([]);
  });

  it.each(MOTIVOS_DE_REDE)("rede, motivo %s: frase própria, sem travessão, emoji nem jargão", (motivo) => {
    for (const tipo of ["instagram", "youtube"] as const) {
      const frase = fraseDaFonteNaoLida({ tipo, lida: false, motivo }) ?? "";
      expect(frase).not.toBe(textosBriefing.contextoDaMarca.naoLida.padraoRede.replace("{rede}", tipo === "instagram" ? "Instagram" : "YouTube"));
      expect(frase).not.toContain("{rede}");
      expect(encontrarProblemas(frase)).toEqual([]);
    }
  });
});
