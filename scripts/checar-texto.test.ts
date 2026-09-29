import { rmSync, writeFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { verificarArquivo, verificarLinha } from "./checar-texto-regras";

describe("verificarLinha", () => {
  it("aceita texto limpo", () => {
    expect(verificarLinha("gente te conhecer, sem travessao nem emoji")).toEqual([]);
  });

  it("reprova travessao", () => {
    const motivos = verificarLinha("um texto \u2014 com travessao");
    expect(motivos.some((m) => m.includes("travessao"))).toBe(true);
  });

  it("reprova emoji", () => {
    const motivos = verificarLinha("seu roteiro esta pronto \u{1F389}");
    expect(motivos.some((m) => m.includes("emoji"))).toBe(true);
  });

  it("reprova jargao mas aceita gancho", () => {
    expect(verificarLinha("olha o hook do video").some((m) => m.includes("hook"))).toBe(true);
    expect(verificarLinha("olha o gancho do video")).toEqual([]);
  });

  it("reprova as palavras da secao 8 do brief-frontend", () => {
    for (const palavra of [
      "engajamento",
      "conversao",
      "alcance",
      "CTA",
      "metricas",
      "dashboard",
      "viral",
      "conteudo",
      "onboarding",
    ]) {
      expect(verificarLinha(`texto com ${palavra} no meio`).length).toBeGreaterThan(0);
    }
  });
});

describe("verificarArquivo: o jargao fica de fora do admin (V12b, item 1)", () => {
  const caminhoAdmin = "src/app/admin/__fixture-checar-texto.tsx";
  const caminhoNaoAdmin = "src/textos/__fixture-checar-texto.ts";

  afterEach(() => {
    rmSync(caminhoAdmin, { force: true });
    rmSync(caminhoNaoAdmin, { force: true });
  });

  it("nao reprova jargao dentro de src/app/admin, mas continua reprovando travessao e emoji", () => {
    writeFileSync(caminhoAdmin, 'const x = "tipo de conteudo — exemplo \u{1F389}";\n');
    const problemas = verificarArquivo(caminhoAdmin);
    expect(problemas.some((p) => p.motivo.startsWith("jargao"))).toBe(false);
    expect(problemas.some((p) => p.motivo.includes("travessao"))).toBe(true);
    expect(problemas.some((p) => p.motivo.includes("emoji"))).toBe(true);
  });

  it("continua reprovando jargao fora do admin", () => {
    writeFileSync(caminhoNaoAdmin, 'const x = "tipo de conteudo";\n');
    const problemas = verificarArquivo(caminhoNaoAdmin);
    expect(problemas.some((p) => p.motivo.startsWith("jargao"))).toBe(true);
  });
});
