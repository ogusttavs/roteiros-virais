import { describe, expect, it } from "vitest";

import { COMENTARIO_TAMANHO_MAXIMO, formaDeComparar, limparComentario, limparTextoDoModelo } from "./comentarios";

const CARINHA = String.fromCodePoint(0x1f60d);
const BANDEIRA = String.fromCodePoint(0x1f1e7, 0x1f1f7);
const TRAVESSAO = String.fromCharCode(0x2014);
const MEIO_TRAVESSAO = String.fromCharCode(0x2013);

describe("limparComentario", () => {
  it("tira a menção a outra pessoa, mas deixa o resto da frase", () => {
    expect(limparComentario("@maria_silva você viu isso? Serve em camurça?")).toBe("você viu isso? Serve em camurça?");
    expect(limparComentario("Vale também para o sofá @joao.pereira2 e para o colchão")).toBe("Vale também para o sofá e para o colchão");
  });

  it("tira endereço de site, e-mail e telefone, em qualquer formato", () => {
    const limpo = limparComentario(
      "Veja em https://exemplo.invalido/loja ou www.exemplo.invalido e fale com contato@exemplo.teste ou (11) 91234-5678 ou +55 11 91234 5678 hoje",
    );
    expect(limpo).toBe("Veja em ou e fale com ou ou hoje");
  });

  it("tira o domínio sozinho, sem protocolo nem www: é o perfil de quem escreveu", () => {
    expect(limparComentario("Me chama em instagram.com/joao_silva88 ou bit.ly/3xYzAb que eu mostro")).toBe("Me chama em ou que eu mostro");
    expect(limparComentario("Compra na loja.com.br/oferta que é mais barato")).toBe("Compra na que é mais barato");
  });

  it("tira o CPF e o número colado", () => {
    expect(limparComentario("meu cpf é 123.456.789-00 e pronto")).toBe("meu cpf é e pronto");
    expect(limparComentario("anota o 11912345678 aí para falar comigo")).toBe("anota o aí para falar comigo");
  });

  it("não confunde faixa de preço, ano, data nem quantidade com telefone", () => {
    for (const texto of [
      "Eu paguei R$ 1.500-2.000 por mês no plano antigo",
      "Isso foi entre 2023-2026 e eu gostei muito",
      "Comprei no dia 10.10.2026 e chegou rápido demais",
      "Foram 150 200 300 unidades que vendi no mês passado",
    ]) {
      expect(limparComentario(texto)).toBe(texto);
    }
    expect(limparComentario("Paguei R$ 1.000,00 em 2026, valeu cada centavo")).toBe("Paguei R$ 1.000,00 em 2026, valeu cada centavo");
  });

  it("o texto em plainText fica como está: '<3' e 'custa < 50' são texto de verdade", () => {
    const texto = "Amei <3 custa < 50 e rende > 3 vezes";
    expect(limparComentario(texto)).toBe(texto);
  });

  it("tira o caractere de controle (o Postgres rejeita o NUL)", () => {
    expect(limparComentario("Tem NUL aqui" + String.fromCharCode(0) + "no meio do texto")).toBe("Tem NUL aqui no meio do texto");
  });

  it("tira o emoji, as bandeiras e as marcas invisíveis", () => {
    expect(limparComentario(`Amei o resultado ${CARINHA}${CARINHA} ficou perfeito ${BANDEIRA}`)).toBe("Amei o resultado ficou perfeito");
  });

  it("troca o travessão por hífen, sem deixar o caractere no texto", () => {
    const limpo = limparComentario(`Isso ${TRAVESSAO} aquilo ${MEIO_TRAVESSAO} funciona mesmo`);
    expect(limpo).toBe("Isso - aquilo - funciona mesmo");
    expect(limpo).not.toContain(TRAVESSAO);
    expect(limpo).not.toContain(MEIO_TRAVESSAO);
  });

  it("fica com a pergunta curta, que é a que mais se repete", () => {
    expect(limparComentario("Preço?")).toBe("Preço?");
    expect(limparComentario("Como faz?")).toBe("Como faz?");
    expect(limparComentario("Funciona?")).toBe("Funciona?");
  });

  it("descarta o que é curto, só emoji, só risada ou só número", () => {
    expect(limparComentario("top")).toBeNull();
    expect(limparComentario("show de bola")).not.toBeNull();
    expect(limparComentario(`${CARINHA}${CARINHA}${CARINHA}${CARINHA}${CARINHA}${CARINHA}`)).toBeNull();
    expect(limparComentario("kkkkkkkkkkkkkkkk")).toBeNull();
    expect(limparComentario("kkkkkk kkkkkkkkkk")).toBeNull();
    expect(limparComentario("kkkk?")).toBeNull();
    expect(limparComentario("??")).toBeNull();
    expect(limparComentario("12345 67890 12345")).toBeNull();
    expect(limparComentario(null)).toBeNull();
    expect(limparComentario(undefined)).toBeNull();
  });

  it("corta o comentário comprido na última palavra inteira", () => {
    const longo = "palavra ".repeat(100);
    const limpo = limparComentario(longo) as string;
    expect(limpo.length).toBeLessThanOrEqual(COMENTARIO_TAMANHO_MAXIMO);
    expect(limpo.endsWith("palavra")).toBe(true);
  });

  it("nada do que sai tem @", () => {
    const entradas = ["@a @b @c oi tudo bem com vocês", "me chama @arroba_do_perfil para falar disso", "email x@y.com e @z também"];
    for (const entrada of entradas) {
      const limpo = limparComentario(entrada);
      if (limpo) expect(limpo).not.toContain("@");
    }
  });
});

describe("limparTextoDoModelo", () => {
  it("tira travessão, emoji, @ e endereço, e deixa uma linha só", () => {
    const limpo = limparTextoDoModelo(`Serve em camurça ${TRAVESSAO} e em linho? ${CARINHA}\nVeja www.exemplo.invalido @alguem`, 140);
    expect(limpo).toBe("Serve em camurça, e em linho? Veja");
  });

  it("tira também telefone e domínio, para o modelo não repetir spam na tela", () => {
    expect(limparTextoDoModelo("Chama no 11 91234 5678 ou em loja.com.br/oferta, serve em camurça?", 140)).toBe("Chama no ou em serve em camurça?");
  });

  it("devolve nulo quando não sobra uma frase", () => {
    expect(limparTextoDoModelo("ok", 140)).toBeNull();
    expect(limparTextoDoModelo(`${CARINHA}${CARINHA}`, 140)).toBeNull();
  });

  it("respeita o tamanho, cortando na palavra", () => {
    const original = "uma frase bem comprida ".repeat(20).trim();
    const limpo = limparTextoDoModelo(original, 50) as string;
    expect(limpo.length).toBeLessThanOrEqual(50);
    // um prefixo do original que acaba antes de um espaço: nunca no meio de uma palavra
    expect(original.startsWith(limpo)).toBe(true);
    expect(original[limpo.length]).toBe(" ");
  });
});

describe("formaDeComparar", () => {
  it("ignora maiúscula, acento e pontuação", () => {
    expect(formaDeComparar("Serve em tecido de camurça?")).toBe(formaDeComparar("serve em tecido de camurca"));
  });
});
