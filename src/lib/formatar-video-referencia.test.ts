import { describe, expect, it } from "vitest";

import { legendaSemHashtags } from "./formatar-video-referencia";

describe("legendaSemHashtags (o título do exemplo é a legenda sem as hashtags)", () => {
  it("tira as hashtags do fim e do meio e arruma o espaço", () => {
    expect(legendaSemHashtags("o passo a passo que todo mundo salva #limpeza #dica")).toBe("o passo a passo que todo mundo salva");
    expect(legendaSemHashtags("antes #sofa e depois #limpezadesofa do jeito certo")).toBe("antes e depois do jeito certo");
    expect(legendaSemHashtags("  linha um\n#a #b\nlinha dois  ")).toBe("linha um linha dois");
  });

  it("não mexe em # que não é hashtag (número, preço) e aceita acento", () => {
    expect(legendaSemHashtags("o item#3 da lista")).toBe("o item#3 da lista");
    expect(legendaSemHashtags("dica #limpeza_pós_obra de hoje")).toBe("dica de hoje");
  });

  it("se a legenda era só hashtag (ou nula), devolve a reserva", () => {
    expect(legendaSemHashtags("#a #b #c", "limpar estofado")).toBe("limpar estofado");
    expect(legendaSemHashtags(null, "limpar estofado")).toBe("limpar estofado");
    expect(legendaSemHashtags(undefined)).toBe("");
  });
});
