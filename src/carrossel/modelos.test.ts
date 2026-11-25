import { describe, expect, it } from "vitest";

import { carrosselAtivo, LINHA_FIXA_ANTES_DEPOIS_SAUDE, TIPOS_DE_SLIDE, type TipoDeSlide } from "@/config/carrossel";

import { contraste, corValida, garantirLeitura, htmlDoSlide, paletaDoSlide } from "./modelos";
import { distribuirFotos } from "./render";
import { crc32, montarZip } from "./zip";

describe("paleta", () => {
  it("o texto e o destaque leem bem (contraste de 4,5 ou mais) em claro e escuro, para cores de marca variadas", () => {
    for (const cor of ["#1f6feb", "#e11d48", "#f5d90a", "#0b3d2e", "#ff8800", "#6b21a8"]) {
      for (const escuro of [true, false]) {
        const p = paletaDoSlide(cor, escuro);
        expect(contraste(p.texto, p.fundo), `${cor} ${escuro}`).toBeGreaterThanOrEqual(4.5);
        expect(contraste(p.destaque, p.fundo), `${cor} ${escuro}`).toBeGreaterThanOrEqual(4.5);
        expect(contraste(p.sobreDestaque, p.destaque), `${cor} ${escuro}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("valida a cor", () => {
    expect(corValida("#1f6feb")).toBe(true);
    expect(corValida("azul")).toBe(false);
    expect(corValida("#fff")).toBe(false);
  });
});

describe("garantirLeitura", () => {
  it("escurece uma cor clara demais até passar de 3:1 e avisa; cor escura fica como está", () => {
    const amarelo = garantirLeitura("#fff3a0");
    expect(amarelo.escureceu).toBe(true);
    expect(contraste(amarelo.cor, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(garantirLeitura("#0e5a6a")).toEqual({ cor: "#0e5a6a", escureceu: false });
  });
});

describe("htmlDoSlide", () => {
  it("o antes e depois mostra a linha fixa de saúde só quando o slide a leva", () => {
    const base = { tipo: "antes-depois" as const, titulo: "Como ficou", corpo: "Antes: a. Depois: b.", fonte: null };
    const com = htmlDoSlide({ slide: { ...base, rodape: LINHA_FIXA_ANTES_DEPOIS_SAUDE }, numero: 2, total: 5, cor: "#1f6feb", fonteBase64: null });
    expect(com).toContain(LINHA_FIXA_ANTES_DEPOIS_SAUDE);
    expect(htmlDoSlide({ slide: base, numero: 2, total: 5, cor: "#1f6feb", fonteBase64: null })).not.toContain("autorização do paciente");
  });

  it("escapa o texto e gera um modelo para cada tipo", () => {
    for (const tipo of TIPOS_DE_SLIDE) {
      const html = htmlDoSlide({ slide: { tipo, titulo: "<b>x</b>", corpo: "a & b", fonte: tipo === "dado" ? "Fonte, 2026" : null }, numero: 2, total: 5, cor: "#1f6feb", fonteBase64: null });
      expect(html).not.toContain("<b>x</b>");
      expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
      expect(html).toContain("data-caixa");
    }
  });
});

describe("distribuirFotos", () => {
  const fotos = [{ id: 10 }, { id: 11 }, { id: 12 }];
  const slide = (tipo: TipoDeSlide, extra = {}) => ({ tipo, titulo: "t", corpo: "c", fonte: null, ...extra });
  it("entrega as fotos na ordem aos tipos que aceitam foto, e duas ao antes e depois", () => {
    const r = distribuirFotos([slide("capa-foto"), slide("antes-depois"), slide("dado"), slide("chamada")], fotos);
    expect(r.map((x) => [x.foto, x.fotoDepois])).toEqual([[10, null], [11, 12], [null, null], [null, null]]);
  });
  it("respeita a foto escolhida e ignora uma que não existe", () => {
    const r = distribuirFotos([slide("capa-foto", { fotoId: 12 }), slide("passo", { fotoId: 999 })], fotos);
    expect(r.map((x) => x.foto)).toEqual([12, 10]);
  });
});

describe("zip", () => {
  it("calcula o crc32 conhecido e monta o cabeçalho de arquivo e o fim do diretório", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    const zip = montarZip([
      { nome: "a.png", bytes: Buffer.from("abc") },
      { nome: "b.png", bytes: Buffer.from("defg") },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(2);
  });
});

describe("a chave", () => {
  it("vem desligada por padrão e só o valor 1 liga", () => {
    const antes = process.env.CARROSSEL_ATIVO;
    try {
      delete process.env.CARROSSEL_ATIVO;
      expect(carrosselAtivo()).toBe(false);
      process.env.CARROSSEL_ATIVO = "true";
      expect(carrosselAtivo()).toBe(false);
      process.env.CARROSSEL_ATIVO = "1";
      expect(carrosselAtivo()).toBe(true);
    } finally {
      if (antes === undefined) delete process.env.CARROSSEL_ATIVO;
      else process.env.CARROSSEL_ATIVO = antes;
    }
  });
});
