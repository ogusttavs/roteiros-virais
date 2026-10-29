import { describe, expect, it } from "vitest";

import { linhasDoTitulo, montarAss, tempoDoAss, textoSeguroDoAss } from "./ass";

describe("ass", () => {
  it("o tempo sai em centésimos, no formato H:MM:SS.cc", () => {
    expect(tempoDoAss(0)).toBe("0:00:00.00");
    expect(tempoDoAss(3.5)).toBe("0:00:03.50");
    expect(tempoDoAss(61.234)).toBe("0:01:01.23");
    expect(tempoDoAss(3725.5)).toBe("1:02:05.50");
  });

  it("o texto nunca carrega comando do ASS nem quebra de linha", () => {
    expect(textoSeguroDoAss("a {\\an8} b\nc\\Nd")).toBe("a an8 b cNd");
    expect(textoSeguroDoAss("  vários   espaços ")).toBe("vários espaços");
  });

  it("o título quebra em até 3 linhas de até 20 letras, sem partir palavra", () => {
    expect(linhasDoTitulo("VOCÊ LAVA A LOUÇA DO JEITO CERTO?")).toEqual(["VOCÊ LAVA A LOUÇA DO", "JEITO CERTO?"]);
    expect(linhasDoTitulo("COMPRAR OU ALUGAR?")).toEqual(["COMPRAR OU ALUGAR?"]);
    const longo = linhasDoTitulo("UM DOIS TRÊS QUATRO CINCO SEIS SETE OITO NOVE DEZ ONZE DOZE TREZE");
    expect(longo.length).toBeLessThanOrEqual(3);
    expect(longo.join(" ")).toBe("UM DOIS TRÊS QUATRO CINCO SEIS SETE OITO NOVE DEZ ONZE DOZE TREZE");
    expect(linhasDoTitulo("   ")).toEqual([]);
  });

  it("o arquivo tem a tela 1080x1920, a caixa branca com texto preto e a fonte embutida", () => {
    const ass = montarAss({ blocos: [{ inicio: 0.5, fim: 1.5, texto: "OI GENTE" }], titulo: { texto: "Você lava a louça?", subtitulo: null }, duracaoS: 10 });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    // Texto preto (&H00000000) e caixa branca (a cor do contorno, BorderStyle 3).
    expect(ass).toMatch(/Style: Legenda,Montserrat,\d+,&H00000000,&H00000000,&H00FFFFFF,&H00000000,-1,0,0,0,100,100,0,0,3,/);
    expect(ass).toContain("Dialogue: 0,0:00:00.50,0:00:01.50,Legenda,,0,0,0,,OI GENTE");
  });

  it("o título abre o vídeo por 3,5 s, em caixa alta, e nunca passa da duração do vídeo", () => {
    const longo = montarAss({ blocos: [], titulo: { texto: "Você lava a louça?", subtitulo: null }, duracaoS: 20 });
    expect(longo).toContain("Dialogue: 1,0:00:00.00,0:00:03.50,Titulo,,0,0,0,,VOCÊ LAVA A LOUÇA?");
    const curto = montarAss({ blocos: [], titulo: { texto: "Oi", subtitulo: null }, duracaoS: 2 });
    expect(curto).toContain("0:00:00.00,0:00:02.00,Titulo");
  });

  it("o subtítulo do título entra numa linha menor, e bloco vazio ou sem tempo é ignorado", () => {
    const ass = montarAss({
      blocos: [
        { inicio: 1, fim: 1, texto: "SEM TEMPO" },
        { inicio: 1, fim: 2, texto: "  " },
        { inicio: 2, fim: 99, texto: "FINAL" },
      ],
      titulo: { texto: "Quanto custa?", subtitulo: "ver o preço" },
      duracaoS: 10,
    });
    expect(ass).toContain("QUANTO CUSTA?\\N{\\fs48}VER O PREÇO");
    expect(ass).not.toContain("SEM TEMPO");
    expect(ass).toContain("0:00:02.00,0:00:10.00,Legenda,,0,0,0,,FINAL");
  });

  it("sem título não há linha de título", () => {
    expect(montarAss({ blocos: [], titulo: { texto: "", subtitulo: null }, duracaoS: 5 })).not.toContain("Dialogue: 1");
  });
});
