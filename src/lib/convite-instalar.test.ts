/**
 * O convite de instalar o aplicativo (E48 PR 1): quando ele vale e como o aparelho é reconhecido.
 */
import { describe, expect, it } from "vitest";

import { adiamentoDoConvite, conviteDeInstalarPodeAparecer, DIAS_DE_ADIAMENTO_DO_CONVITE, sistemaDoAparelho } from "./convite-instalar";

const AGORA = new Date("2026-10-03T12:00:00Z");
const DIA_MS = 24 * 60 * 60 * 1000;

describe("conviteDeInstalarPodeAparecer", () => {
  it("sem preferências ainda, ou sem nada gravado, pode aparecer", () => {
    expect(conviteDeInstalarPodeAparecer(null, AGORA)).toBe(true);
    expect(conviteDeInstalarPodeAparecer({ instaladoEm: null, conviteInstalarAdiadoAte: null }, AGORA)).toBe(true);
  });

  it("instalado, nunca mais (mesmo com o adiamento vencido)", () => {
    expect(conviteDeInstalarPodeAparecer({ instaladoEm: new Date(AGORA.getTime() - DIA_MS), conviteInstalarAdiadoAte: null }, AGORA)).toBe(false);
    expect(
      conviteDeInstalarPodeAparecer({ instaladoEm: AGORA, conviteInstalarAdiadoAte: new Date(AGORA.getTime() - 10 * DIA_MS) }, AGORA),
    ).toBe(false);
  });

  it("agora não vale até a data e volta depois dela", () => {
    const ate = adiamentoDoConvite(AGORA);
    expect(ate.getTime() - AGORA.getTime()).toBe(DIAS_DE_ADIAMENTO_DO_CONVITE * DIA_MS);
    expect(DIAS_DE_ADIAMENTO_DO_CONVITE).toBe(7);
    expect(conviteDeInstalarPodeAparecer({ instaladoEm: null, conviteInstalarAdiadoAte: ate }, new Date(AGORA.getTime() + 6 * DIA_MS))).toBe(false);
    expect(conviteDeInstalarPodeAparecer({ instaladoEm: null, conviteInstalarAdiadoAte: ate }, new Date(AGORA.getTime() + 7 * DIA_MS + 1))).toBe(true);
  });
});

describe("sistemaDoAparelho", () => {
  it("reconhece o iPhone e o Android de celular; o resto é outro", () => {
    expect(sistemaDoAparelho("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1")).toBe("iphone");
    expect(sistemaDoAparelho("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36")).toBe("android");
    // Tablet Android (sem Mobile), Mac (e o iPad novo, que se apresenta como Mac), Windows e vazio: nenhum convite.
    expect(sistemaDoAparelho("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36")).toBe("outro");
    expect(sistemaDoAparelho("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15")).toBe("outro");
    expect(sistemaDoAparelho("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36")).toBe("outro");
    expect(sistemaDoAparelho("")).toBe("outro");
  });
});
