import { describe, expect, it } from "vitest";

import { MINUTOS_TRAVA_LEITURA, estadoDaSecao } from "./contexto-marca-regras";

const AGORA = new Date("2026-10-03T12:00:00Z");
const antes = (minutos: number) => new Date(AGORA.getTime() - minutos * 60_000);

const BASE = { temFonte: true, ultimaLeituraOkEm: null, ultimaTentativaEm: null, lendoDesde: null, agora: AGORA };

describe("estadoDaSecao", () => {
  it("sem nenhuma fonte informada", () => {
    expect(estadoDaSecao({ ...BASE, temFonte: false })).toBe("sem_fonte");
    // Mesmo com leitura antiga: se a pessoa tirou o site e os perfis, não há de onde ler.
    expect(estadoDaSecao({ ...BASE, temFonte: false, ultimaLeituraOkEm: antes(60) })).toBe("sem_fonte");
  });

  it("com fonte e nenhuma tentativa ainda: lendo", () => {
    expect(estadoDaSecao(BASE)).toBe("lendo");
  });

  it("leitura em andamento (trava recente): lendo", () => {
    expect(estadoDaSecao({ ...BASE, ultimaTentativaEm: antes(2), lendoDesde: antes(2) })).toBe("lendo");
  });

  it("trava velha demais é leitura interrompida: tentou e não deu", () => {
    expect(
      estadoDaSecao({ ...BASE, ultimaTentativaEm: antes(MINUTOS_TRAVA_LEITURA + 5), lendoDesde: antes(MINUTOS_TRAVA_LEITURA + 5) }),
    ).toBe("nao_leu");
  });

  it("tentou e a leitura não rendeu", () => {
    expect(estadoDaSecao({ ...BASE, ultimaTentativaEm: antes(60) })).toBe("nao_leu");
  });

  it("com leitura boa fica ok, mesmo que uma leitura nova esteja em andamento", () => {
    expect(estadoDaSecao({ ...BASE, ultimaLeituraOkEm: antes(60 * 24), ultimaTentativaEm: antes(1), lendoDesde: antes(1) })).toBe("ok");
  });
});
