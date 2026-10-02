/**
 * Achado 11 da revisão do motor (01/10/2026): o lembrete de acentuação como última linha da
 * entrada. Esta tarefa não tem retentativa nenhuma hoje, então a posição já nasce definitiva.
 */
import { describe, expect, it } from "vitest";

import { montarEntrada, schema } from "./extrairVideoSemFala";

describe("montarEntrada", () => {
  it("o lembrete de acentuacao e a ultima linha da entrada", () => {
    const entrada = montarEntrada({ titulo: "titulo qualquer", legenda: "legenda qualquer", duracaoS: 30, nomeNicho: "nicho", termosNicho: [] });
    expect(entrada.endsWith("acentuação correta do português (você, não, já, também, é, está), mesmo que o título ou a legenda do post estejam sem acento.")).toBe(true);
  });
});

function fichaExemplo(sobrescreve: Partial<Record<"formato" | "tipoConteudo" | "serveDeModelo", unknown>> = {}) {
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
    tipoConteudo: "original",
    serveDeModelo: true,
    ...sobrescreve,
  };
}

/** M5b, item 2: mesmo conserto de `extrairVideo.ts` (formato fora da lista vira "outro"). */
describe("schema, formato fora da lista vira outro (M5b, item 2)", () => {
  it("formato desconhecido vira outro, sem reprovar a ficha inteira", () => {
    const resultado = schema.safeParse(fichaExemplo({ formato: "formato_que_nao_existe" }));
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.formato).toBe("outro");
  });
});

/** E43, item 0 (achado da prova com chave real do PR #102): mesmo conserto de `extrairVideo.ts`. */
describe("schema, tipoConteudo invalido (E43, item 0)", () => {
  it("tipoConteudo desconhecido vira original, e serveDeModelo e forcado para false mesmo que tivesse vindo true", () => {
    const resultado = schema.safeParse(fichaExemplo({ tipoConteudo: "anuncio", serveDeModelo: true }));
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.tipoConteudo).toBe("original");
    expect(resultado.success && resultado.data.serveDeModelo).toBe(false);
  });

  it("tipoConteudo valido continua exato, com o serveDeModelo que veio", () => {
    const resultado = schema.safeParse(fichaExemplo({ tipoConteudo: "recorte", serveDeModelo: false }));
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.tipoConteudo).toBe("recorte");
    expect(resultado.success && resultado.data.serveDeModelo).toBe(false);
  });
});
