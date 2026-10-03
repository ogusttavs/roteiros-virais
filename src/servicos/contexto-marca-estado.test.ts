import { describe, expect, it } from "vitest";

import { MINUTOS_TRAVA_LEITURA, TETO_ITENS_ATIVOS, estadoDaSecao, tentativaRecenteDemais } from "./contexto-marca-regras";

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

  it("a trava vale até o minuto exato do prazo: um minuto antes ainda lê, no minuto o prazo venceu", () => {
    expect(estadoDaSecao({ ...BASE, ultimaTentativaEm: antes(MINUTOS_TRAVA_LEITURA - 1), lendoDesde: antes(MINUTOS_TRAVA_LEITURA - 1) })).toBe("lendo");
    expect(estadoDaSecao({ ...BASE, ultimaTentativaEm: antes(MINUTOS_TRAVA_LEITURA), lendoDesde: antes(MINUTOS_TRAVA_LEITURA) })).toBe("nao_leu");
  });
});

describe("os minutos entre leituras por evento", () => {
  const dez = 10;

  it("sem tentativa anterior nunca é recente demais", () => {
    expect(tentativaRecenteDemais(null, AGORA, dez)).toBe(false);
  });

  it("antes dos dez minutos é recente demais; nos dez minutos exatos já não é", () => {
    expect(tentativaRecenteDemais(antes(9), AGORA, dez)).toBe(true);
    expect(tentativaRecenteDemais(antes(10), AGORA, dez)).toBe(false);
    expect(tentativaRecenteDemais(antes(11), AGORA, dez)).toBe(false);
  });
});

describe("o teto de itens vivos", () => {
  it("a seção comporta doze", () => {
    expect(TETO_ITENS_ATIVOS).toBe(12);
  });
});
