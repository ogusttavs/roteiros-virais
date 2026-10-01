/**
 * R1, item 1: confere que toda regra numerada da seção 9 de `estrategia/briefing-e-rubricas.md`
 * existe no código, e vice-versa (o documento é a fonte; o código não inventa regra). O documento
 * mora no repositório de documentos, fora do checkout da CI (`actions/checkout@v4` traz só
 * `plataforma/`): sem ele presente, o teste avisa e pula, em vez de derrubar a suíte; quem mexe
 * localmente, com os dois repositórios lado a lado (`acessos/TROCA-DE-MAQUINA.md`), continua com
 * a conferência de verdade.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  REGRAS_REEL,
  REGRAS_SHORT,
  REGRAS_STORY,
  REGRAS_TIKTOK,
  REGRAS_YT_VIDEO,
  regrasDoReels,
} from "./regras-formato";

const CAMINHO_RUBRICAS = path.resolve(process.cwd(), "../estrategia/briefing-e-rubricas.md");

function numerosDaSecao9(): string[] {
  const texto = readFileSync(CAMINHO_RUBRICAS, "utf8");
  const inicio = texto.indexOf("## 9. As regras por plataforma e formato");
  const fim = texto.indexOf("## 10. As regras de fala");
  const secao9 = texto.slice(inicio, fim === -1 ? undefined : fim);
  const encontradas = secao9.matchAll(/^\|\s*(R-[A-Z]+-[A-Z]+-\d{2})\s*\|/gm);
  return [...encontradas].map((m) => m[1]);
}

describe("as 45 regras de plataforma, código contra a seção 9 das rubricas", () => {
  const existe = existsSync(CAMINHO_RUBRICAS);

  it.skipIf(!existe)("todo número da seção 9 existe no código, e todo número do código existe na seção 9", () => {
    const daSecao9 = new Set(numerosDaSecao9());
    const doCodigo = new Set([
      ...REGRAS_STORY,
      ...REGRAS_REEL,
      ...REGRAS_TIKTOK,
      ...REGRAS_SHORT,
      ...REGRAS_YT_VIDEO,
    ].map((r) => r.numero));

    const faltamNoCodigo = [...daSecao9].filter((n) => !doCodigo.has(n));
    const sobramNoCodigo = [...doCodigo].filter((n) => !daSecao9.has(n));

    expect(faltamNoCodigo).toEqual([]);
    expect(sobramNoCodigo).toEqual([]);
    expect(daSecao9.size).toBe(45);
  });

  if (!existe) {
    console.warn(
      `regras-formato.test.ts: ${CAMINHO_RUBRICAS} não encontrado (normal na CI, que só tem o checkout de plataforma/); a conferência contra a seção 9 não rodou.`,
    );
  }
});

describe("as 35 regras novas, sem repetir numero e com o texto copiado (nao reescrito)", () => {
  it("nenhum numero se repete entre os cinco conjuntos", () => {
    const todas = [...REGRAS_STORY, ...REGRAS_REEL, ...REGRAS_TIKTOK, ...REGRAS_SHORT, ...REGRAS_YT_VIDEO];
    const numeros = todas.map((r) => r.numero);
    expect(new Set(numeros).size).toBe(numeros.length);
  });

  it("cada conjunto tem a quantidade certa de regras", () => {
    expect(REGRAS_STORY.length).toBe(10);
    expect(REGRAS_REEL.length).toBe(11);
    expect(REGRAS_TIKTOK.length).toBe(12);
    expect(REGRAS_SHORT.length).toBe(8);
    expect(REGRAS_YT_VIDEO.length).toBe(4);
  });
});

describe("regrasDoReels", () => {
  it("sem rede principal, devolve Instagram (o padrao do produto)", () => {
    expect(regrasDoReels(null, undefined)).toEqual({ nome: "Instagram", regras: REGRAS_REEL });
    expect(regrasDoReels(undefined, undefined)).toEqual({ nome: "Instagram", regras: REGRAS_REEL });
  });

  it("instagram devolve R-IG-REEL", () => {
    expect(regrasDoReels("instagram", undefined)).toEqual({ nome: "Instagram", regras: REGRAS_REEL });
  });

  it("tiktok devolve R-TT-VIDEO", () => {
    expect(regrasDoReels("tiktok", undefined)).toEqual({ nome: "TikTok", regras: REGRAS_TIKTOK });
  });

  it("youtube sem duracao tipica acima de 60s devolve so R-YT-SHORT", () => {
    expect(regrasDoReels("youtube", undefined)).toEqual({ nome: "YouTube", regras: REGRAS_SHORT });
    expect(regrasDoReels("youtube", 60)).toEqual({ nome: "YouTube", regras: REGRAS_SHORT });
  });

  it("youtube com duracao tipica acima de 60s soma R-YT-VIDEO a R-YT-SHORT", () => {
    const resultado = regrasDoReels("youtube", 61);
    expect(resultado.nome).toBe("YouTube");
    expect(resultado.regras).toEqual([...REGRAS_SHORT, ...REGRAS_YT_VIDEO]);
  });
});
