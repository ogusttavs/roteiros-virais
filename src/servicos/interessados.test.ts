/**
 * O "Quero testar" da página de entrada (E57a), a parte que não precisa de banco: a validação de quem pede (o servidor refaz tudo, o navegador não vale), o WhatsApp
 * reduzido a dígitos e o número por extenso. A gravação, o aviso ao admin, o limite de pedidos e a lista ficam em `tests/integracao/interessados.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { textosInteressados } from "@/textos/interessados";

import { normalizarWhatsapp, validarInteresse, whatsappPorExtenso } from "./interessados";

const BOM = { nome: "Ana Prado", email: "ana@exemplo.com.br", whatsapp: "11 91234-5678", ramo: "dentista", aceite: true };

describe("normalizarWhatsapp", () => {
  it("fica só com os dígitos, com DDD e sem o 55 do país", () => {
    expect(normalizarWhatsapp("11 91234-5678")).toBe("11912345678");
    expect(normalizarWhatsapp("(11) 91234-5678")).toBe("11912345678");
    expect(normalizarWhatsapp("+55 11 91234-5678")).toBe("11912345678");
    expect(normalizarWhatsapp("5511912345678")).toBe("11912345678");
    expect(normalizarWhatsapp("11 3234-5678")).toBe("1132345678");
  });

  it("recusa o que não é um número do Brasil: curto, longo, sem o 9 do celular, DDD começando em zero, letras, vazio, não texto", () => {
    for (const ruim of ["", "123", "91234-5678", "11 81234-5678", "01 91234-5678", "11 91234-56789", "abcdefghijk", "00 00000-0000"]) {
      expect(normalizarWhatsapp(ruim), ruim).toBeNull();
    }
    expect(normalizarWhatsapp(undefined)).toBeNull();
    expect(normalizarWhatsapp(11912345678)).toBeNull();
    expect(normalizarWhatsapp(null)).toBeNull();
  });
});

describe("whatsappPorExtenso", () => {
  it("separa o DDD e o hífen, no celular e no fixo", () => {
    expect(whatsappPorExtenso("11912345678")).toBe("11 91234-5678");
    expect(whatsappPorExtenso("1132345678")).toBe("11 3234-5678");
  });
});

describe("validarInteresse", () => {
  it("aceita o pedido completo, limpa os espaços, põe o e-mail em minúsculas e guarda o WhatsApp só com dígitos", () => {
    const r = validarInteresse({ ...BOM, nome: "  Ana   Prado ", email: " ANA@Exemplo.com.br ", ramo: "  clínica\nodontológica " });
    expect(r).toEqual({ ok: true, dados: { nome: "Ana Prado", email: "ana@exemplo.com.br", whatsapp: "11912345678", ramo: "clínica odontológica" } });
  });

  it("sem o aceite do contato não passa, mesmo com tudo certo (o aceite é a base da lista)", () => {
    for (const aceite of [false, undefined, "true", "on", 1]) {
      const r = validarInteresse({ ...BOM, aceite });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.erros).toEqual({ aceite: textosInteressados.erros.aceite });
    }
  });

  it("devolve o erro de cada campo ruim, com a frase do produto", () => {
    const r = validarInteresse({ nome: "A", email: "sem-arroba", whatsapp: "123", ramo: "", aceite: false });
    expect(r).toEqual({
      ok: false,
      erros: {
        nome: textosInteressados.erros.nome,
        email: textosInteressados.erros.email,
        whatsapp: textosInteressados.erros.whatsapp,
        ramo: textosInteressados.erros.ramo,
        aceite: textosInteressados.erros.aceite,
      },
    });
  });

  it("recusa e-mail torto: sem domínio, com espaço, com dois arrobas, com sinal de tag", () => {
    for (const ruim of ["ana@", "@exemplo.com", "ana@exemplo", "ana @exemplo.com", "ana@@exemplo.com", "<a>@exemplo.com", "ana@exemplo.c"]) {
      const r = validarInteresse({ ...BOM, email: ruim });
      expect(r.ok, ruim).toBe(false);
    }
  });

  it("recusa nome e ramo grandes demais e e-mail acima de 254 caracteres", () => {
    expect(validarInteresse({ ...BOM, nome: "a".repeat(81) }).ok).toBe(false);
    expect(validarInteresse({ ...BOM, ramo: "a".repeat(81) }).ok).toBe(false);
    expect(validarInteresse({ ...BOM, email: `${"a".repeat(250)}@exemplo.com` }).ok).toBe(false);
  });

  it("não quebra com o que não é texto nem objeto: devolve os erros de campo, nunca lança", () => {
    for (const lixo of [null, undefined, 42, "texto", [], { nome: { x: 1 }, email: ["a@b.co"], whatsapp: {}, ramo: 3, aceite: true }]) {
      const r = validarInteresse(lixo);
      expect(r.ok).toBe(false);
    }
  });

  it("tira caracteres de controle do nome (não vira quebra de linha no e-mail ao admin)", () => {
    const r = validarInteresse({ ...BOM, nome: "Ana\r\nBcc: x@y.com" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dados.nome).toBe("Ana Bcc: x@y.com");
  });
});
