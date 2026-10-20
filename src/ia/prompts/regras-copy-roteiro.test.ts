/**
 * E50 parte 2, PR 1: a tabela gerada contra a seção 11 das rubricas, e o que o prompt recebe dela.
 * O documento mora no repositório de documentos, fora do checkout da CI: sem ele, a conferência
 * contra o documento pula (e avisa); as demais continuam.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { lerTabelaDaSecao11, montarArquivoGerado } from "../../../scripts/gerar-regras-copy-roteiro-lib";

import { REGRAS_COPY_ROTEIRO } from "./regras-copy-roteiro";
import {
  NUMEROS_REGRAS_COPY_ROTEIRO,
  codigosEscondidosNoTexto,
  numerosVisiveisNoPrompt,
  regrasQueEntramNoPrompt,
  textoDaRegraParaOPrompt,
  textoRegrasCopyRoteiro,
} from "./regras-copy-roteiro-uso";

const CAMINHO_RUBRICAS = path.resolve(process.cwd(), "../estrategia/briefing-e-rubricas.md");
const CAMINHO_GERADO = path.resolve(process.cwd(), "src/ia/prompts/regras-copy-roteiro.ts");
const TRAVESSOES = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
const QUEBRA = String.fromCharCode(10);

describe("a tabela gerada das 53 regras (seção 11)", () => {
  it("tem 25 R-COPY, 19 R-ROTEIRO e 9 R-CONF, sem número repetido", () => {
    const por = (g: string) => REGRAS_COPY_ROTEIRO.filter((r) => r.grupo === g).length;
    expect(REGRAS_COPY_ROTEIRO).toHaveLength(53);
    expect(por("COPY")).toBe(25);
    expect(por("ROTEIRO")).toBe(19);
    expect(por("CONF")).toBe(9);
    expect(NUMEROS_REGRAS_COPY_ROTEIRO.size).toBe(53);
  });

  it("nenhuma regra sem fonte, sem texto, sem por quê ou sem bloco", () => {
    for (const r of REGRAS_COPY_ROTEIRO) {
      expect(r.fonte.length, `${r.numero} fonte`).toBeGreaterThan(2);
      expect(r.texto.length, `${r.numero} texto`).toBeGreaterThan(10);
      expect(r.porQue.length, `${r.numero} porQue`).toBeGreaterThan(10);
      expect(r.bloco.length, `${r.numero} bloco`).toBeGreaterThan(2);
      expect(r.numero.startsWith(`R-${r.grupo}-`)).toBe(true);
    }
  });

  it("nenhum travessão e nenhum emoji no que o prompt e a tela vão ler", () => {
    for (const r of REGRAS_COPY_ROTEIRO) {
      for (const campo of [r.texto, r.porQue]) {
        for (const t of TRAVESSOES) expect(campo.includes(t), `${r.numero} travessão`).toBe(false);
        expect(/\p{Extended_Pictographic}/u.test(campo), `${r.numero} emoji`).toBe(false);
      }
    }
  });

  it("a força e a coluna 'confere por código' foram lidas do começo da célula", () => {
    const porNumero = new Map(REGRAS_COPY_ROTEIRO.map((r) => [r.numero, r]));
    expect(porNumero.get("R-ROTEIRO-05")?.forca).toBe("forte");
    expect(porNumero.get("R-COPY-21")?.forca).toBe("media");
    expect(porNumero.get("R-COPY-03")?.forca).toBe("indicio");
    expect(porNumero.get("R-COPY-03")?.conferePorCodigo).toBe("so_avisa");
    expect(porNumero.get("R-CONF-07")?.conferePorCodigo).toBe("sim");
    expect(porNumero.get("R-CONF-08")?.conferePorCodigo).toBe("nao");
    expect(porNumero.get("R-COPY-04")?.conferePorCodigo).toBe("nao");
  });

  const existe = existsSync(CAMINHO_RUBRICAS);
  it.skipIf(!existe)("o arquivo gerado é exatamente o que o gerador produz da seção 11 de hoje", () => {
    const doDocumento = lerTabelaDaSecao11(readFileSync(CAMINHO_RUBRICAS, "utf8"));
    expect(doDocumento).toEqual(REGRAS_COPY_ROTEIRO);
    // O checkout no Windows pode trazer CRLF; o que importa é o texto.
    expect(readFileSync(CAMINHO_GERADO, "utf8").split(String.fromCharCode(13)).join("")).toBe(montarArquivoGerado(doDocumento));
  });
  if (!existe) {
    console.warn(`regras-copy-roteiro.test.ts: ${CAMINHO_RUBRICAS} não encontrado (normal na CI); a conferência contra o documento não rodou.`);
  }
});

describe("o gerador (lógica pura)", () => {
  const linha = (n: string, forca = "média", confere = "sim (lista)") =>
    `| ${n} | texto de ${n} | por que de ${n} | gancho | ${forca} | ${confere} | AR 1:1 | não testada |`;
  const doc = (linhas: string[]) =>
    ["## 11. As regras", "", "| Regra | a |", "|---|---|", ...linhas, "", "## 12. Outra", "| R-COPY-01 | x |"].join(QUEBRA);

  it("recusa documento sem a seção 11", () => {
    expect(() => lerTabelaDaSecao11("## 10. Fala")).toThrow(/seção 11/);
  });

  it("recusa quantidade diferente da esperada", () => {
    expect(() => lerTabelaDaSecao11(doc([linha("R-COPY-01")]))).toThrow(/R-COPY: esperava 25/);
  });

  it("recusa linha com número de colunas errado", () => {
    expect(() => lerTabelaDaSecao11(doc(["| R-COPY-01 | só duas colunas |"]))).toThrow(/8 colunas/);
  });

  it("recusa força desconhecida", () => {
    expect(() => lerTabelaDaSecao11(doc([linha("R-COPY-01", "talvez")]))).toThrow(/força desconhecida/);
  });

  it("lê só a seção 11 (para na próxima de nível 2) e normaliza força e coluna de conferência", () => {
    const todas = [
      ...Array.from({ length: 25 }, (_, i) => linha(`R-COPY-${String(i + 1).padStart(2, "0")}`)),
      ...Array.from({ length: 19 }, (_, i) => linha(`R-ROTEIRO-${String(i + 1).padStart(2, "0")}`)),
      ...Array.from({ length: 9 }, (_, i) => linha(`R-CONF-${String(i + 1).padStart(2, "0")}`, "forte (lei)")),
    ];
    const regras = lerTabelaDaSecao11(doc(todas));
    expect(regras).toHaveLength(53);
    expect(regras[0]).toMatchObject({ numero: "R-COPY-01", forca: "media", conferePorCodigo: "sim", grupo: "COPY" });
    expect(regras[52]).toMatchObject({ numero: "R-CONF-09", forca: "forte" });
  });
});

describe("o que o prompt recebe", () => {
  it("só as de força forte e média entram; as de indício ficam fora", () => {
    const entram = regrasQueEntramNoPrompt();
    expect(entram).toHaveLength(28);
    expect(entram.every((r) => r.forca !== "indicio")).toBe(true);
    const texto = textoRegrasCopyRoteiro();
    expect(texto).toContain("R-ROTEIRO-05");
    expect(texto).toContain("R-COPY-21");
    expect(texto).not.toContain("R-COPY-03 ");
    expect(texto).not.toContain("R-ROTEIRO-19");
    expect(texto).not.toContain("R-COPY-04 ");
  });

  it("as de conformidade vêm antes de copy e de estrutura, com a nota de não advogado e a pendência do conselho", () => {
    const texto = textoRegrasCopyRoteiro();
    const conf = texto.indexOf("R-CONF-01");
    expect(conf).toBeGreaterThan(-1);
    expect(conf).toBeLessThan(texto.indexOf("R-COPY-01"));
    expect(conf).toBeLessThan(texto.indexOf("R-ROTEIRO-01"));
    expect(texto).toContain("quem não é advogado");
    expect(texto).toContain("conselho da profissão");
    expect(texto).toContain('nunca use "antes e depois"');
  });

  it("diz a precedência e que as regras não entram no porQueAssim", () => {
    const texto = textoRegrasCopyRoteiro();
    expect(texto).toContain("evidência do banco");
    expect(texto).toContain("Não as cite no porQueAssim");
  });

  it("cada linha traz o bloco da regra, e 'todos' vira 'todos os blocos'", () => {
    const texto = textoRegrasCopyRoteiro();
    expect(texto).toMatch(/R-COPY-05 \(gancho, corpo\)/);
    expect(texto).toMatch(/R-COPY-01 \(todos os blocos\)/);
  });

  it("não tem travessão nem emoji", () => {
    const texto = textoRegrasCopyRoteiro();
    for (const t of TRAVESSOES) expect(texto.includes(t)).toBe(false);
    expect(/\p{Extended_Pictographic}/u.test(texto)).toBe(false);
  });

  it("nenhum código de regra que o prompt não mostra sobra no texto (nem de outra rede, nem de regra de indício)", () => {
    const visiveis = numerosVisiveisNoPrompt();
    for (const r of regrasQueEntramNoPrompt()) {
      const texto = textoDaRegraParaOPrompt(r.texto, visiveis);
      expect(codigosEscondidosNoTexto(texto, visiveis), r.numero).toEqual([]);
    }
    const prompt = textoRegrasCopyRoteiro();
    for (const proibido of ["R-IG-", "R-TT-", "R-YT-", "R-FALA-", "seção 9"]) expect(prompt.includes(proibido), proibido).toBe(false);
  });

  it("a referência a regra visível fica; a de regra escondida sai com o parêntese e a frase continua inteira", () => {
    const visiveis = new Set(["R-CONF-02"]);
    expect(textoDaRegraParaOPrompt("O número vem da ficha (`R-CONF-02`). Vale (`R-IG-REEL-03`).", visiveis)).toBe(
      "O número vem da ficha (`R-CONF-02`). Vale.",
    );
    expect(textoDaRegraParaOPrompt("Pedido (`R-IG-REEL-08`, `R-TT-VIDEO-10`, `R-IG-STORY-04` e `-07`).", visiveis)).toBe("Pedido.");
    expect(textoDaRegraParaOPrompt("O número é pedido por `R-TT-VIDEO-07` e `R-YT-SHORT-05`.", visiveis)).toBe(
      "O número é pedido pelas regras da plataforma.",
    );
  });
});
