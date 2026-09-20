import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { config } from "./config";
import { lerClienteIdDoCookie, valorCookieMarcaAtiva } from "./marca-ativa";

describe("valorCookieMarcaAtiva e lerClienteIdDoCookie", () => {
  it("assina e le de volta o mesmo id", () => {
    const valor = valorCookieMarcaAtiva(42);
    expect(lerClienteIdDoCookie(valor)).toBe(42);
  });

  it("cookie ausente: null", () => {
    expect(lerClienteIdDoCookie(undefined)).toBeNull();
  });

  it("cookie sem separador: null", () => {
    expect(lerClienteIdDoCookie("42")).toBeNull();
  });

  it("cookie adulterado (id trocado, assinatura antiga): null", () => {
    const valor = valorCookieMarcaAtiva(42);
    const [, assinatura] = valor.split(".");
    expect(lerClienteIdDoCookie(`99.${assinatura}`)).toBeNull();
  });

  it("cookie com assinatura invalida: null", () => {
    expect(lerClienteIdDoCookie("42.assinaturafalsa")).toBeNull();
  });

  it("cookie com id nao inteiro, mesmo com assinatura valida para esse valor: null", () => {
    const assinatura = createHmac("sha256", config.auth.secret).update("abc").digest("hex");
    expect(lerClienteIdDoCookie(`abc.${assinatura}`)).toBeNull();
  });
});
