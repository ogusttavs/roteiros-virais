/**
 * E50 parte 2, PR 3: o "por quê" de cada bloco, em função pura. O texto sai da tabela, por código; o que o
 * modelo escreve (números, id de vídeo, "para") é conferido e descartado quando não existe.
 */
import { describe, expect, it } from "vitest";

import { REGRAS_COPY_ROTEIRO } from "@/ia/prompts/regras-copy-roteiro";

import {
  chavesDeBlocos,
  limparPorQueDosBlocos,
  numerosCitaveis,
  PARA_QUE,
  regraValeParaOBloco,
  temPorQue,
  textosDoPorQue,
  type ContextoDaLimpeza,
  type PorQueBruto,
} from "./por-que-do-bloco";

const reels: ContextoDaLimpeza = { forma: { tipo: "reels", telas: 2 }, escopo: "curto", segundoDosVideos: new Map([[7, 12]]) };
const bruto = (b: Partial<PorQueBruto> & { bloco: string }): PorQueBruto => ({ regras: [], videoId: null, para: null, ...b });
const regra = (n: string) => REGRAS_COPY_ROTEIRO.find((r) => r.numero === n)!;

describe("chavesDeBlocos", () => {
  it("Reels: quatro blocos e uma chave por frase na tela", () => {
    expect([...chavesDeBlocos({ tipo: "reels", telas: 2 })].sort()).toEqual(["chamada", "corpo", "fechamento", "gancho", "tela:0", "tela:1"]);
  });
  it("Story e sem fala: um por cartão", () => {
    expect([...chavesDeBlocos({ tipo: "cartoes", cartoes: 3 })]).toEqual(["cartao:0", "cartao:1", "cartao:2"]);
  });
  it("longo: gancho, chamada, capítulos e telas", () => {
    expect([...chavesDeBlocos({ tipo: "longo", capitulos: 2, telas: 1 })].sort()).toEqual(["capitulo:0", "capitulo:1", "chamada", "gancho", "tela:0"]);
  });
});

describe("numerosCitaveis", () => {
  it("o curto cita as 27 que o prompt mostra; o longo, só conformidade e texto", () => {
    expect(numerosCitaveis("curto").size).toBe(27);
    const longo = numerosCitaveis("longo");
    expect([...longo].some((n) => n.startsWith("R-ROTEIRO-"))).toBe(false);
    expect(longo.has("R-COPY-13")).toBe(true);
    expect(longo.has("R-CONF-03")).toBe(true);
  });
  it("regra de indício nunca é citável (o modelo não a viu)", () => {
    expect(numerosCitaveis("curto").has("R-COPY-21")).toBe(false);
    expect(numerosCitaveis("curto").has("R-COPY-03")).toBe(false);
  });
});

describe("regraValeParaOBloco", () => {
  it("'todos' vale em qualquer bloco; a coluna Bloco da tabela manda nos outros", () => {
    expect(regraValeParaOBloco(regra("R-COPY-12"), "tela:0", 0)).toBe(true);
    expect(regraValeParaOBloco(regra("R-CONF-03"), "gancho", 0)).toBe(true);
    expect(regraValeParaOBloco(regra("R-CONF-03"), "chamada", 0)).toBe(true);
    expect(regraValeParaOBloco(regra("R-CONF-03"), "corpo", 0)).toBe(false);
    expect(regraValeParaOBloco(regra("R-ROTEIRO-15"), "fechamento", 0)).toBe(true);
    expect(regraValeParaOBloco(regra("R-ROTEIRO-15"), "gancho", 0)).toBe(false);
  });
  it("cartão: o primeiro vale como gancho e o último como chamada e fechamento", () => {
    expect(regraValeParaOBloco(regra("R-CONF-03"), "cartao:0", 3)).toBe(true);
    expect(regraValeParaOBloco(regra("R-CONF-03"), "cartao:1", 3)).toBe(false);
    expect(regraValeParaOBloco(regra("R-CONF-03"), "cartao:2", 3)).toBe(true);
    expect(regraValeParaOBloco(regra("R-ROTEIRO-15"), "cartao:2", 3)).toBe(true);
  });
  it("capítulo vale como corpo", () => {
    expect(regraValeParaOBloco(regra("R-COPY-13"), "capitulo:1", 0)).toBe(true);
    expect(regraValeParaOBloco(regra("R-COPY-06"), "capitulo:1", 0)).toBe(false);
  });
});

describe("limparPorQueDosBlocos", () => {
  it("guarda o que é válido, com o segundo do banco e não o do modelo", () => {
    const r = limparPorQueDosBlocos([bruto({ bloco: "gancho", regras: ["R-COPY-05"], videoId: 7, para: "fiquem" })], reels);
    expect(r).toEqual([{ bloco: "gancho", regras: ["R-COPY-05"], video: { videoId: 7, segundo: 12 }, para: "fiquem" }]);
  });
  it("descarta bloco que não existe (tela:2 com duas telas)", () => {
    expect(limparPorQueDosBlocos([bruto({ bloco: "tela:2", regras: ["R-COPY-12"] })], reels)).toEqual([]);
  });
  it("descarta número que não existe, regra de indício e regra de outro bloco", () => {
    const r = limparPorQueDosBlocos([bruto({ bloco: "corpo", regras: ["R-XXX-01", "R-COPY-21", "R-CONF-03", "R-COPY-13"] })], reels);
    expect(r).toEqual([{ bloco: "corpo", regras: ["R-COPY-13"] }]);
  });
  it("vídeo fora da evidência cai; sem regra válida e sem vídeo, o bloco não entra", () => {
    expect(limparPorQueDosBlocos([bruto({ bloco: "corpo", regras: ["R-COPY-13"], videoId: 99 })], reels)).toEqual([{ bloco: "corpo", regras: ["R-COPY-13"] }]);
    expect(limparPorQueDosBlocos([bruto({ bloco: "corpo", regras: ["R-XXX-01"], videoId: 99 })], reels)).toEqual([]);
  });
  it("um vídeo sozinho não basta: sem regra válida não há o que faz", () => {
    expect(limparPorQueDosBlocos([bruto({ bloco: "corpo", videoId: 7 })], reels)).toEqual([]);
  });
  it("bloco repetido fica com a primeira entrada; no máximo três regras; regra repetida conta uma vez", () => {
    const r = limparPorQueDosBlocos(
      [
        bruto({ bloco: "corpo", regras: ["R-COPY-13", "R-COPY-13", "R-COPY-12", "R-COPY-01", "R-COPY-02"] }),
        bruto({ bloco: "corpo", regras: ["R-COPY-15"] }),
      ],
      reels,
    );
    expect(r).toHaveLength(1);
    expect(r[0].regras).toEqual(["R-COPY-13", "R-COPY-12", "R-COPY-01"]);
  });
  it("'para' fora da lista cai sem derrubar o bloco", () => {
    const r = limparPorQueDosBlocos([bruto({ bloco: "corpo", regras: ["R-COPY-13"], para: "vendam" as never })], reels);
    expect(r).toEqual([{ bloco: "corpo", regras: ["R-COPY-13"] }]);
  });
  it("no longo, regra de estrutura do vídeo curto cai", () => {
    const longo: ContextoDaLimpeza = { forma: { tipo: "longo", capitulos: 2, telas: 0 }, escopo: "longo", segundoDosVideos: new Map() };
    expect(limparPorQueDosBlocos([bruto({ bloco: "capitulo:1", regras: ["R-ROTEIRO-05", "R-COPY-13"] })], longo)).toEqual([{ bloco: "capitulo:1", regras: ["R-COPY-13"] }]);
  });
});

describe("textosDoPorQue", () => {
  it("'O que faz' é a frase da tabela, por código; 'Com base em' é o tipo de regra; 'Para' é a lista fixa", () => {
    const t = textosDoPorQue({ bloco: "corpo", regras: ["R-COPY-13"], para: "guardem" });
    expect(t.oQueFaz).toBe(regra("R-COPY-13").porQue);
    expect(t.comBaseEm).toEqual({ tipo: "regra", texto: "uma regra de escrita para vídeo" });
    expect(t.para).toBe("Para a pessoa guardar e usar depois.");
  });
  it("com duas ou três regras, 'O que faz' junta no máximo duas frases, a primeira regra primeiro", () => {
    const t = textosDoPorQue({ bloco: "corpo", regras: ["R-COPY-12", "R-COPY-13", "R-COPY-01"] });
    expect(t.oQueFaz).toBe(`${regra("R-COPY-12").porQue} ${regra("R-COPY-13").porQue}`);
    expect(t.oQueFaz).not.toContain(regra("R-COPY-01").porQue);
  });
  it("com vídeo, 'Com base em' é o vídeo no segundo", () => {
    expect(textosDoPorQue({ bloco: "gancho", regras: ["R-COPY-05"], video: { videoId: 7, segundo: 12 } }).comBaseEm).toEqual({ tipo: "video", videoId: 7, segundo: 12 });
  });
  it("nunca mostra o código da regra nem travessão", () => {
    for (const r of REGRAS_COPY_ROTEIRO) {
      const t = textosDoPorQue({ bloco: "corpo", regras: [r.numero], para: "confiem" });
      const todo = [t.oQueFaz, t.para ?? "", t.comBaseEm && t.comBaseEm.tipo === "regra" ? t.comBaseEm.texto : ""].join(" ");
      expect(todo, r.numero).not.toMatch(/R-[A-Z]+-[0-9]/);
      expect(todo.includes(String.fromCharCode(0x2013)) || todo.includes(String.fromCharCode(0x2014))).toBe(false);
    }
  });
  it("todo 'para' tem texto", () => {
    for (const p of PARA_QUE) expect(textosDoPorQue({ bloco: "corpo", regras: [], para: p }).para).toBeTruthy();
  });
});

describe("temPorQue", () => {
  it("só quando há regra", () => {
    expect(temPorQue(undefined)).toBe(false);
    expect(temPorQue({ bloco: "corpo", regras: [] })).toBe(false);
    expect(temPorQue({ bloco: "corpo", regras: ["R-COPY-13"] })).toBe(true);
    expect(temPorQue({ bloco: "corpo", regras: [], video: { videoId: 1, segundo: 0 } })).toBe(false);
  });
});
