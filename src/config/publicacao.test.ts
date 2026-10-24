import { describe, expect, it } from "vitest";

import { fraseDeFalha, fraseDeRecusa, textosPublicar, type CodigoDeFalha, type CodigoDeRecusa } from "@/textos/publicar";

import { ESPERA_PADRAO_DA_CONFERENCIA_S, esperaDaConferencia, PREPARO_DA_META_PRAZO_MS } from "./publicacao";

describe("o ritmo e o prazo da conferência com a Meta", () => {
  it("a primeira espera é de 10 s, as quatro primeiras sobem (10, 20, 30, 45) e depois é uma por minuto, como a Meta recomenda", () => {
    expect([0, 1, 2, 3, 4].map(esperaDaConferencia)).toEqual([10, 10, 20, 30, 45]);
    expect([5, 6, 20, 1000].map(esperaDaConferencia)).toEqual([ESPERA_PADRAO_DA_CONFERENCIA_S, 60, 60, 60]);
    expect(ESPERA_PADRAO_DA_CONFERENCIA_S).toBe(60);
  });

  it("o prazo é de 6 minutos (os 5 que a Meta pede mais uma folga)", () => {
    expect(PREPARO_DA_META_PRAZO_MS).toBe(6 * 60 * 1000);
  });
});

describe("os textos da publicação não levam termo técnico de vídeo", () => {
  it("nenhuma frase fala de codec, som ou imagem em sigla", () => {
    const frases: string[] = [];
    for (const codigo of Object.keys(textosPublicar.falha) as CodigoDeFalha[]) for (const tipo of ["reels", "story"] as const) frases.push(fraseDeFalha(codigo, tipo));
    for (const codigo of Object.keys(textosPublicar.recusa) as CodigoDeRecusa[]) for (const tipo of ["reels", "story"] as const) frases.push(fraseDeRecusa(codigo, tipo));
    const tela = textosPublicar.tela;
    frases.push(tela.ajudaReels(300), tela.ajudaStory(100), ...Object.values(tela).filter((v): v is string => typeof v === "string"));
    const tudo = frases.join(" ").toLowerCase();
    expect(tudo.length).toBeGreaterThan(500);
    for (const termo of ["aac", "h.264", "h264", "hevc", "codec", "bitrate", "contêiner", "token"]) expect(tudo, termo).not.toContain(termo);
  });
});
