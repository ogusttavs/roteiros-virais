/**
 * Achado 11 da revisão do motor (01/10/2026): o lembrete de acentuação como última linha da
 * entrada. Esta tarefa roda em lote, sem `gerarComVerificacao`, então a posição já nasce
 * definitiva aqui mesmo.
 */
import { describe, expect, it } from "vitest";

import { FORMATOS_DO_VIDEO } from "@/config/formatos";

import { montarEntrada, montarSistemaEstavel, schema } from "./extrairVideo";

const BASE = { titulo: "titulo qualquer", descricao: null, handle: null, transcricao: "transcricao qualquer", nomeNicho: "nicho", termosNicho: [] };

describe("montarEntrada", () => {
  it("o lembrete de acentuacao e a ultima linha da entrada", () => {
    const entrada = montarEntrada(BASE);
    expect(entrada.endsWith("acentuação correta do português (você, não, já, também, é, está), mesmo que a transcrição original esteja em outro idioma ou sem acento.")).toBe(true);
  });

  /** M5b, achado 7 da revisão do motor (01/10/2026): a legenda e o @ da conta entram na entrada. */
  it("sem legenda e sem conta, a entrada diz isso em vez de ficar vazia", () => {
    const entrada = montarEntrada(BASE);
    expect(entrada).toContain("Conta: (sem conta)");
    expect(entrada).toContain("Legenda do post: (sem legenda)");
  });

  it("com legenda e conta, as duas aparecem na entrada", () => {
    const entrada = montarEntrada({ ...BASE, descricao: "Olha como ficou o sofa #limpezaprofissional", handle: "sofamaislimpo" });
    expect(entrada).toContain("Conta: @sofamaislimpo");
    expect(entrada).toContain("Legenda do post: Olha como ficou o sofa #limpezaprofissional");
  });

  it("legenda maior que 400 caracteres entra cortada, sem partir um emoji ao meio", () => {
    // 399 letras mais um emoji de duas unidades UTF-16 (mesmo caso do hotfix de `titulo.ts`); em
    // escape, para `checar-texto` (varre src/ia/prompts/**, inclusive `.test.ts`) não reprovar.
    const descricao = `${"a".repeat(399)}\u{1F600}resto da legenda`;
    const entrada = montarEntrada({ ...BASE, descricao, handle: "conta" });
    const linhaLegenda = entrada.split("\n").find((l) => l.startsWith("Legenda do post:"));
    expect(linhaLegenda).toBe(`Legenda do post: ${"a".repeat(399)}\u{1F600}`);
  });
});

/**
 * M5b, item 2 (achado de produção em 02/10: 2 de 92 saídas do lote reprovaram o schema inteiro
 * por um valor fora da lista em `formato` ou `tipoAbertura`). O valor desconhecido vira "outro"
 * em vez de perder a ficha inteira do vídeo.
 */
function fichaExemplo(sobrescreve: Partial<Record<"formato" | "tipoAbertura" | "idioma" | "tipoConteudo" | "serveDeModelo", unknown>> = {}) {
  return {
    assunto: "assunto",
    gancho: "gancho",
    estrutura: "estrutura",
    fechamento: "fechamento",
    chamadaFinal: "chamada",
    formato: "fala_para_camera",
    porQueFuncionou: "porque",
    etiquetas: [],
    pertenceAoNicho: true,
    motivoNicho: "motivo",
    idioma: "pt-BR",
    tipoAbertura: "cena",
    tipoConteudo: "original",
    serveDeModelo: true,
    ...sobrescreve,
  };
}

describe("schema, valor fora da lista em formato/tipoAbertura vira outro (M5b, item 2)", () => {
  it("formato desconhecido vira outro, sem reprovar a ficha inteira", () => {
    const resultado = schema.safeParse(fichaExemplo({ formato: "formato_que_nao_existe" }));
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.formato).toBe("outro");
  });

  it("tipoAbertura desconhecido vira outro, sem reprovar a ficha inteira", () => {
    const resultado = schema.safeParse(fichaExemplo({ tipoAbertura: "abertura_que_nao_existe" }));
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.tipoAbertura).toBe("outro");
  });

  it("formato e tipoAbertura dentro da lista continuam exatos (nao forca outro sem precisar)", () => {
    const resultado = schema.safeParse(fichaExemplo({ formato: "podcast", tipoAbertura: "numero" }));
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.formato).toBe("podcast");
    expect(resultado.success && resultado.data.tipoAbertura).toBe("numero");
  });
});

/**
 * E43, item 0 (achado da prova com chave real do PR #102): `idioma` e `tipoConteudo` fora da
 * lista também reprovavam a ficha inteira.
 */
describe("schema, idioma e tipoConteudo invalidos (E43, item 0)", () => {
  it("idioma desconhecido vira outro, sem reprovar a ficha inteira", () => {
    const resultado = schema.safeParse(fichaExemplo({ idioma: "idioma_que_nao_existe" }));
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.idioma).toBe("outro");
  });

  it("tipoConteudo desconhecido vira original, e serveDeModelo e forcado para false mesmo que tivesse vindo true", () => {
    const resultado = schema.safeParse(fichaExemplo({ tipoConteudo: "anuncio", serveDeModelo: true }));
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.tipoConteudo).toBe("original");
    expect(resultado.success && resultado.data.serveDeModelo).toBe(false);
  });

  it("tipoConteudo valido continua exato, com o serveDeModelo que veio", () => {
    const resultado = schema.safeParse(fichaExemplo({ tipoConteudo: "meme", serveDeModelo: false }));
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.tipoConteudo).toBe("meme");
    expect(resultado.success && resultado.data.serveDeModelo).toBe(false);
  });
});

/** E44 PR 1: o formato pela lista fechada (as treze chaves do cliente mais os valores que nunca servem de modelo). */
describe("formatoCatalogo", () => {
  const FICHA = {
    assunto: "a",
    gancho: "g",
    estrutura: "e",
    fechamento: "f",
    chamadaFinal: "c",
    formato: "fala_para_camera",
    porQueFuncionou: "p",
    etiquetas: [],
    pertenceAoNicho: true,
    motivoNicho: "m",
    idioma: "pt-BR",
    tipoAbertura: "outro",
    tipoConteudo: "original",
    serveDeModelo: true,
  };

  it("o prompt traz a definição de uma frase de cada um dos 19 valores", () => {
    const sistema = montarSistemaEstavel();
    for (const chave of FORMATOS_DO_VIDEO) expect(sistema, chave).toContain(`"${chave}":`);
  });

  it("um valor da lista passa; um valor fora da lista vira 'outro' em vez de perder a ficha inteira (mesmo conserto do M5b)", () => {
    expect(schema.parse({ ...FICHA, formatoCatalogo: "antes_e_depois" })).toMatchObject({ formatoCatalogo: "antes_e_depois" });
    expect(schema.parse({ ...FICHA, formatoCatalogo: "tutorial" })).toMatchObject({ formatoCatalogo: "outro" });
    expect(schema.parse(FICHA)).toMatchObject({ formatoCatalogo: "outro" });
  });
});
