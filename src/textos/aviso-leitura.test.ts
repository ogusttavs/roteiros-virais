/**
 * O e-mail da leitura parada (23/10/2026): cada causa diz o que parou, desde quando e o que fazer, e nada do que o projeto proíbe (travessão, emoji, marca).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return { ...original, config: { ...original.config, appUrl: "https://painel.exemplo.teste", appName: "Painel" } };
});

import { textosAvisoDeLeitura, type ParadaParaOAviso } from "./aviso-leitura";

const desde = new Date("2026-10-03T12:00:00.000Z");
const CAUSAS = ["proxy sem trafego", "proxy recusou o acesso", "proxy fora do ar", "bloqueio", "sem leitura"] as const;

describe("textosAvisoDeLeitura", () => {
  it("o proxy sem tráfego diz que acabou o pacote, desde quando e manda recarregar", () => {
    const p: ParadaParaOAviso = { plataforma: "youtube", causa: "proxy sem trafego", desde, dias: 20 };
    const html = textosAvisoDeLeitura.corpo([p], "https://painel.exemplo.teste/admin");
    expect(textosAvisoDeLeitura.assunto([p])).toBe("A leitura de vídeos parou: YouTube");
    expect(html).toContain("YouTube");
    expect(html).toContain("o proxy está sem tráfego");
    expect(html).toContain("desde 3 de outubro, há 20 dias");
    expect(html).toContain("Recarregue o pacote do proxy");
    expect(html).toContain("uma leitura de prova por noite");
    expect(html).toContain("https://painel.exemplo.teste/admin");
  });

  it("mais de uma rede: o assunto junta os nomes, e cada uma tem o seu bloco", () => {
    const paradas: ParadaParaOAviso[] = [
      { plataforma: "youtube", causa: "proxy sem trafego", desde, dias: 20 },
      { plataforma: "tiktok", causa: "proxy sem trafego", desde, dias: 20 },
      { plataforma: "instagram", causa: "sem leitura", desde, dias: 0 },
    ];
    expect(textosAvisoDeLeitura.assunto(paradas)).toBe("A leitura de vídeos parou: YouTube, TikTok e Instagram");
    const html = textosAvisoDeLeitura.corpo(paradas, "https://x.teste/admin");
    expect(html).toContain("<strong>Instagram</strong>");
    expect(html).toContain("desde hoje (3 de outubro)");
    expect(html).toContain("Rotinas");
  });

  it("o bloqueio não manda pagar nada, e a senha do proxy não manda comprar pacote", () => {
    const bloqueio = textosAvisoDeLeitura.bloco({ plataforma: "youtube", causa: "bloqueio", desde, dias: 1 });
    expect(bloqueio).toContain("desde 3 de outubro, há 1 dia.");
    expect(bloqueio).toContain("Não há nada a pagar");
    const recusou = textosAvisoDeLeitura.bloco({ plataforma: "youtube", causa: "proxy recusou o acesso", desde, dias: 1 });
    expect(recusou).toContain("senha");
    expect(recusou).not.toContain("Recarregue");
  });

  it("sem travessão nem emoji em nenhuma causa", () => {
    for (const causa of CAUSAS) {
      const texto = textosAvisoDeLeitura.bloco({ plataforma: "tiktok", causa, desde, dias: 2 });
      expect(texto).not.toMatch(/[\u2013\u2014]/);
      expect(texto).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect(textosAvisoDeLeitura.rodape).not.toMatch(/[\u2013\u2014]/);
  });
});
