import { describe, expect, it } from "vitest";

import { normalizarSite, siteValido, TAMANHO_MAXIMO_DO_SITE } from "./site-valido";

describe("siteValido", () => {
  it("aceita https com dominio", () => {
    expect(siteValido("https://drwash.com.br")).toBe(true);
    expect(siteValido("https://www.drwash.com.br/sobre")).toBe(true);
  });

  it("recusa http (sem s)", () => {
    expect(siteValido("http://drwash.com.br")).toBe(false);
  });

  it("recusa localhost e endereco de rede interna (SSRF)", () => {
    expect(siteValido("https://localhost")).toBe(false);
    expect(siteValido("https://localhost:3000")).toBe(false);
    expect(siteValido("https://127.0.0.1")).toBe(false);
    expect(siteValido("https://10.0.0.5")).toBe(false);
    expect(siteValido("https://192.168.1.1")).toBe(false);
    expect(siteValido("https://172.16.0.1")).toBe(false);
    expect(siteValido("https://[::1]")).toBe(false);
  });

  it("recusa sem dominio (host sem ponto)", () => {
    expect(siteValido("https://drwash")).toBe(false);
  });

  it("recusa texto que nao e uma URL", () => {
    expect(siteValido("drwash.com.br")).toBe(false);
    expect(siteValido("")).toBe(false);
  });

  it("recusa endereço numérico, mesmo público, e as faixas de rede interna e de nuvem", () => {
    expect(siteValido("https://8.8.8.8")).toBe(false);
    expect(siteValido("https://169.254.169.254")).toBe(false);
    expect(siteValido("https://100.64.0.1")).toBe(false);
    expect(siteValido("https://100.127.255.255")).toBe(false);
    expect(siteValido("https://0.0.0.0")).toBe(false);
    expect(siteValido("https://0x7f.1")).toBe(false);
    expect(siteValido("https://[2001:db8::1]")).toBe(false);
  });

  it("recusa porta, credencial e nome que só existe dentro de uma rede", () => {
    expect(siteValido("https://exemplo.com:6379/")).toBe(false);
    expect(siteValido("https://exemplo.com:443/")).toBe(true);
    expect(siteValido("https://usuario:senha@exemplo.com")).toBe(false);
    expect(siteValido("https://usuario@exemplo.com")).toBe(false);
    expect(siteValido("https://app.localhost")).toBe(false);
    expect(siteValido("https://impressora.local")).toBe(false);
    expect(siteValido("https://painel.internal")).toBe(false);
  });

  it("recusa o que passa do tamanho que se grava", () => {
    expect(siteValido(`https://exemplo.com/${"a".repeat(TAMANHO_MAXIMO_DO_SITE)}`)).toBe(false);
    expect(siteValido(`https://${"a".repeat(300)}.com`)).toBe(false);
    expect(siteValido(`https://exemplo.com/${"a".repeat(100)}`)).toBe(true);
  });
});

describe("normalizarSite", () => {
  it("o endereço sem esquema vira https, e o resultado é válido", () => {
    expect(normalizarSite("minhaloja.com.br")).toBe("https://minhaloja.com.br");
    expect(normalizarSite("  www.minhaloja.com.br/sobre  ")).toBe("https://www.minhaloja.com.br/sobre");
    expect(siteValido(normalizarSite("minhaloja.com.br"))).toBe(true);
  });

  it("vazio continua vazio; quem escreveu um esquema fica como escreveu (e a validação recusa)", () => {
    expect(normalizarSite("   ")).toBe("");
    expect(normalizarSite("http://minhaloja.com.br")).toBe("http://minhaloja.com.br");
    expect(siteValido(normalizarSite("http://minhaloja.com.br"))).toBe(false);
    expect(siteValido(normalizarSite("javascript:alert(1)"))).toBe(false);
    expect(siteValido(normalizarSite("//minhaloja.com.br"))).toBe(true);
  });

  it("endereço com porta digitada continua recusado (não vira esquema)", () => {
    expect(siteValido(normalizarSite("minhaloja.com.br:8080/x"))).toBe(false);
  });
});
