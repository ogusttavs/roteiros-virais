import { describe, expect, it } from "vitest";

import { siteValido } from "./site-valido";

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
});
