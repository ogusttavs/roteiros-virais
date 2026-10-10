import { describe, expect, it } from "vitest";

import { textosVozes } from "./vozes-do-publico";

describe("textosVozes.leitura", () => {
  it("conta o que foi lido: o vídeo no singular, os vídeos no plural, a plataforma e o dia", () => {
    expect(textosVozes.leitura(1, ["youtube"], "11 de outubro")).toBe(
      "Dos comentários do vídeo mais visto do seu setor no YouTube, lidos em 11 de outubro. É a nossa leitura: ninguém é citado pelo nome.",
    );
    expect(textosVozes.leitura(12, ["youtube"], "11 de outubro")).toBe(
      "Dos comentários dos 12 vídeos mais vistos do seu setor no YouTube, lidos em 11 de outubro. É a nossa leitura: ninguém é citado pelo nome.",
    );
  });

  it("junta as plataformas na ordem em que chegam, sem repetir", () => {
    expect(textosVozes.leitura(8, ["youtube", "instagram"], "11 de outubro")).toContain("no YouTube e Instagram,");
    expect(textosVozes.leitura(8, ["youtube", "youtube"], "11 de outubro")).toContain("no YouTube,");
  });

  it("sem plataforma na lista, diz YouTube (a única que a leitura cobre hoje)", () => {
    expect(textosVozes.leitura(3, [], "11 de outubro")).toContain("no YouTube,");
  });
});

describe("textosVozes.vezes", () => {
  it("o tipo muda o verbo e o singular não leva plural", () => {
    expect(textosVozes.vezes("duvida", 14)).toBe("perguntado 14 vezes");
    expect(textosVozes.vezes("objecao", 7)).toBe("reclamado 7 vezes");
    expect(textosVozes.vezes("pedido", 1)).toBe("pedido 1 vez");
  });
});
