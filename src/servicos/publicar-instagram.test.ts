/**
 * E56 PR 1: as partes de `servicos/publicar-instagram.ts` que não precisam de banco: de um erro da Meta (ou da rede) para o motivo em língua de gente, e a legenda de partida do roteiro.
 * O fluxo inteiro, com o banco, está em `tests/integracao/publicar-instagram.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { ConteudoRoteiro } from "@/db/schema";
import { ErroMetaLogin } from "@/lib/meta-oauth";
import { ErroDeEnvioDoVideo } from "@/lib/meta-publicar";
import { ErroTokenCifrado } from "@/lib/meta-token";
import { fraseDeFalha, textosPublicar, type CodigoDeFalha } from "@/textos/publicar";

import { classificarFalha, legendaDoRoteiro } from "./publicar-instagram";

const TRAVESSOS = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

describe("classificarFalha: o erro da Meta vira o motivo que a pessoa entende", () => {
  const casos: [string, unknown, CodigoDeFalha][] = [
    ["formato do vídeo (2207026)", new ErroMetaLogin("x", 352, 2207026), "formato"],
    ["limite de posts do dia (2207042)", new ErroMetaLogin("x", 9, 2207042), "limite-do-dia"],
    ["conta restrita (2207050)", new ErroMetaLogin("x", 25, 2207050), "conta-restrita"],
    ["barrada por spam (2207051)", new ErroMetaLogin("x", 4, 2207051), "barrada"],
    ["legenda longa (2207010)", new ErroMetaLogin("x", 36004, 2207010), "legenda"],
    ["legenda longa só pelo código 36004", new ErroMetaLogin("x", 36004), "legenda"],
    ["erro do servidor do Instagram (2207001)", new ErroMetaLogin("x", -1, 2207001), "sem-resposta"],
    ["não conseguiu preparar (2207053)", new ErroMetaLogin("x", -1, 2207053), "nao-preparou"],
    ["acesso recusado (190)", new ErroMetaLogin("x", 190), "acesso-perdido"],
    ["sessão inválida (102)", new ErroMetaLogin("x", 102), "acesso-perdido"],
    ["falta a permissão (10)", new ErroMetaLogin("x", 10), "sem-permissao"],
    ["falta a permissão (200 a 299)", new ErroMetaLogin("x", 283), "sem-permissao"],
    ["a Meta pede para esperar (4, 17, 32, 613)", new ErroMetaLogin("x", 613), "esperar"],
    ["o acesso guardado não abre", new ErroTokenCifrado("x"), "acesso-perdido"],
    ["rede ou prazo (sem código)", new ErroMetaLogin("x"), "sem-resposta"],
    ["código que não conhecemos", new ErroMetaLogin("x", 1234), "nao-preparou"],
    ["envio com retriable verdadeiro", new ErroDeEnvioDoVideo("x", true), "sem-resposta"],
    ["envio com retriable falso", new ErroDeEnvioDoVideo("x", false), "nao-preparou"],
    ["qualquer outro erro", new Error("estourou"), "sem-resposta"],
  ];
  it.each(casos)("%s", (_nome, erro, esperado) => {
    expect(classificarFalha(erro).codigo).toBe(esperado);
  });

  it("guarda o código e o subcódigo da Meta só para diagnóstico", () => {
    expect(classificarFalha(new ErroMetaLogin("x", 352, 2207026))).toEqual({ codigo: "formato", codigoMeta: 352, subcodigoMeta: 2207026 });
  });

  it("o subcódigo manda no código (o 2207026 vem com código 352, que sozinho não diz nada)", () => {
    expect(classificarFalha(new ErroMetaLogin("x", 190, 2207026)).codigo).toBe("formato");
  });

  it("nenhuma frase de falha leva travessão, emoji, token ou o texto cru da Meta", () => {
    for (const codigo of Object.keys(textosPublicar.falha) as CodigoDeFalha[]) {
      for (const tipo of ["reels", "story"] as const) {
        const frase = fraseDeFalha(codigo, tipo);
        expect(frase.length).toBeGreaterThan(20);
        expect(frase).not.toMatch(TRAVESSOS);
        expect(frase).not.toMatch(/token|API|OAuth|\{|\}/i);
      }
    }
  });

  it("a frase do vídeo que não foi preparado diz o limite certo de Reels e de Story (a fonte é a documentação baixada)", () => {
    expect(fraseDeFalha("nao-preparou", "reels")).toContain("15 minutos");
    expect(fraseDeFalha("nao-preparou", "reels")).toContain("300 MB");
    expect(fraseDeFalha("nao-preparou", "story")).toContain("60 segundos");
    expect(fraseDeFalha("nao-preparou", "story")).toContain("100 MB");
  });
});

describe("legendaDoRoteiro: a legenda de partida", () => {
  const base = { titulo: "Três erros ao lavar a louça", chamadaFinal: "Chame no WhatsApp e peça o seu orçamento." } as ConteudoRoteiro;

  it("usa a legenda do próprio roteiro quando ele tem uma", () => {
    expect(legendaDoRoteiro({ conteudo: { ...base, legenda: "Legenda pronta #louça" } })).toBe("Legenda pronta #louça");
  });

  it("sem legenda, junta o título e a chamada final", () => {
    expect(legendaDoRoteiro({ conteudo: base })).toBe("Três erros ao lavar a louça\n\nChame no WhatsApp e peça o seu orçamento.");
    expect(legendaDoRoteiro({ conteudo: { ...base, legenda: "   " } })).toContain("Três erros");
  });

  it("nunca passa do máximo do Instagram", () => {
    expect([...legendaDoRoteiro({ conteudo: { ...base, legenda: "a".repeat(5000) } })].length).toBe(2200);
  });
});
