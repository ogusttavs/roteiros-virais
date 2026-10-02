/**
 * Achado 11 da revisão do motor (01/10/2026): o lembrete de acentuação como última linha da
 * entrada. Esta tarefa roda em lote, sem `gerarComVerificacao`, então a posição já nasce
 * definitiva aqui mesmo.
 */
import { describe, expect, it } from "vitest";

import { montarEntrada, schema } from "./extrairVideo";

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
function fichaExemplo(sobrescreve: Partial<Record<"formato" | "tipoAbertura", unknown>> = {}) {
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
