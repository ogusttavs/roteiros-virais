import { describe, expect, it } from "vitest";

import { DURACAO_VER_COMO_MS, lerCookieVerComo, valorCookieVerComo, type CarregaVerComo } from "./ver-como-cookie";

const AGORA = new Date("2026-10-05T12:00:00Z");
const CARGA: CarregaVerComo = { a: "admin-1", p: "pessoa-1", c: 7, r: 42, e: AGORA.getTime() + DURACAO_VER_COMO_MS };

describe("o cookie do ver como", () => {
  it("dura 30 minutos", () => {
    expect(DURACAO_VER_COMO_MS).toBe(30 * 60 * 1000);
  });

  it("um cookie assinado e dentro da hora volta com a carga", () => {
    const leitura = lerCookieVerComo(valorCookieVerComo(CARGA), AGORA);
    expect(leitura).toEqual({ estado: "valido", carga: CARGA });
  });

  it("depois da hora é expirado, mesmo com a assinatura certa (o 31º minuto)", () => {
    const depois = new Date(AGORA.getTime() + DURACAO_VER_COMO_MS + 1000);
    const leitura = lerCookieVerComo(valorCookieVerComo(CARGA), depois);
    expect(leitura.estado).toBe("expirado");
    // Exatamente na hora também já não vale.
    expect(lerCookieVerComo(valorCookieVerComo(CARGA), new Date(CARGA.e)).estado).toBe("expirado");
  });

  it("sem cookie é ausente", () => {
    expect(lerCookieVerComo(undefined, AGORA)).toEqual({ estado: "ausente" });
    expect(lerCookieVerComo("", AGORA)).toEqual({ estado: "ausente" });
  });

  it("cookie forjado, adulterado ou estragado é inválido, nunca válido", () => {
    const bom = valorCookieVerComo(CARGA);
    const [corpo, assinatura] = bom.split(".");
    // Carga trocada (outra pessoa) com a assinatura antiga.
    const outraCarga = Buffer.from(JSON.stringify({ ...CARGA, p: "pessoa-2" }), "utf8").toString("base64url");
    expect(lerCookieVerComo(`${outraCarga}.${assinatura}`, AGORA).estado).toBe("invalido");
    // Assinatura trocada.
    expect(lerCookieVerComo(`${corpo}.${"0".repeat(assinatura.length)}`, AGORA).estado).toBe("invalido");
    // Sem assinatura, lixo, e uma carga assinada por quem não tem o segredo.
    expect(lerCookieVerComo(corpo, AGORA).estado).toBe("invalido");
    expect(lerCookieVerComo("lixo.lixo", AGORA).estado).toBe("invalido");
    expect(lerCookieVerComo(`${Buffer.from("{}").toString("base64url")}.abcd`, AGORA).estado).toBe("invalido");
  });
});
