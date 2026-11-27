import { describe, expect, it } from "vitest";

import { dataDaCapa, limparTituloDaCapa, motivoDeNaoServirParaCapa, motivoDoTitulo, noticiaServeParaCapa, numerosForaDaNoticia, titulosParaATela, veiculoDaCapa, verificarTitulosDaCapa } from "./capa-noticia";

const AGORA = new Date("2026-11-25T15:00:00Z");
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 24 * 60 * 60 * 1000);
const NOTICIA = { titulo: "Frente fria deixa 3 cidades em alerta de umidade", resumo: "A previsão é de 80% de umidade até sexta.", angulo: null };

describe("a notícia que serve para capa", () => {
  it("só com data conhecida, de até 7 dias, e com o veículo", () => {
    expect(noticiaServeParaCapa({ publicadoEm: diasAtras(0), fonte: "Jornal da Cidade" }, AGORA)).toBe(true);
    expect(noticiaServeParaCapa({ publicadoEm: diasAtras(6.9), fonte: "Jornal da Cidade" }, AGORA)).toBe(true);
    expect(noticiaServeParaCapa({ publicadoEm: diasAtras(7.2), fonte: "Jornal da Cidade" }, AGORA)).toBe(false);
    expect(noticiaServeParaCapa({ publicadoEm: diasAtras(30), fonte: "Jornal da Cidade" }, AGORA)).toBe(false);
    expect(noticiaServeParaCapa({ publicadoEm: null, fonte: "Jornal da Cidade" }, AGORA)).toBe(false);
    expect(noticiaServeParaCapa({ publicadoEm: diasAtras(1), fonte: null }, AGORA)).toBe(false);
    expect(noticiaServeParaCapa({ publicadoEm: diasAtras(1), fonte: "   " }, AGORA)).toBe(false);
  });

  it("a recusa diz o motivo em frase para a pessoa", () => {
    expect(motivoDeNaoServirParaCapa({ publicadoEm: diasAtras(10), fonte: "G1" }, AGORA)).toMatch(/7 dias/);
    expect(motivoDeNaoServirParaCapa({ publicadoEm: diasAtras(1), fonte: "" }, AGORA)).toMatch(/de onde veio/);
    expect(motivoDeNaoServirParaCapa({ publicadoEm: diasAtras(1), fonte: "G1" }, AGORA)).toBeNull();
  });

  it("o veículo sai limpo e no limite do campo; a data no dia de São Paulo", () => {
    expect(veiculoDaCapa("  <b>Jornal</b>\n da  Cidade ")).toBe("b Jornal /b da Cidade");
    expect(veiculoDaCapa("x".repeat(100))).toHaveLength(60);
    expect(veiculoDaCapa(null)).toBe("");
    expect(dataDaCapa(new Date("2026-11-25T01:30:00Z"))).toBe("24/11/2026");
    expect(dataDaCapa(new Date("2026-11-25T15:00:00Z"))).toBe("25/11/2026");
  });
});

describe("os títulos da capa", () => {
  const bons = ["O que a frente fria muda no seu cuidado com a casa", "Umidade em alerta: veja o que fazer", "Sua casa está pronta para a umidade?"];

  it("três títulos dentro do limite passam", () => {
    expect(verificarTitulosDaCapa(bons, NOTICIA, { ramoSaude: false })).toEqual([]);
  });

  it("o limite do tipo: até 14 palavras e 90 caracteres", () => {
    expect(motivoDoTitulo("um dois três quatro cinco seis sete oito nove dez onze doze treze catorze")).toBeNull();
    expect(motivoDoTitulo("um dois três quatro cinco seis sete oito nove dez onze doze treze catorze quinze")).toMatch(/14 palavras/);
    expect(motivoDoTitulo("a".repeat(91))).toMatch(/90 caracteres/);
    expect(motivoDoTitulo("   ")).toMatch(/vazio/);
    const motivos = verificarTitulosDaCapa([...bons.slice(0, 2), "palavra ".repeat(20).trim()], NOTICIA, { ramoSaude: false });
    expect(motivos.join("|")).toMatch(/título 3: O título passa de 14 palavras/);
  });

  it("de 3 a 5 títulos", () => {
    expect(verificarTitulosDaCapa(bons.slice(0, 2), NOTICIA, { ramoSaude: false }).join()).toMatch(/2 títulos/);
    expect(verificarTitulosDaCapa([...bons, "Quarto título aqui", "Quinto título aqui", "Sexto título aqui"], NOTICIA, { ramoSaude: false }).join()).toMatch(/6 títulos/);
  });

  it("T114: na 2ª tentativa e título a título basta um (o que reprova sai da lista), e nenhum continua reprovando", () => {
    expect(verificarTitulosDaCapa([bons[0]], NOTICIA, { ramoSaude: false, minimo: 1 })).toEqual([]);
    expect(verificarTitulosDaCapa(bons.slice(0, 2), NOTICIA, { ramoSaude: false, minimo: 1 })).toEqual([]);
    expect(verificarTitulosDaCapa([], NOTICIA, { ramoSaude: false, minimo: 1 }).join()).toMatch(/0 títulos, o pedido é de 1 a 5/);
    expect(verificarTitulosDaCapa(["palavra ".repeat(20).trim()], NOTICIA, { ramoSaude: false, minimo: 1 }).join()).toMatch(/14 palavras/);
  });

  it("número que a notícia não tem reprova; o que ela tem passa, com ou sem separador", () => {
    expect(numerosForaDaNoticia("87% erram isso", NOTICIA.titulo + " " + NOTICIA.resumo)).toEqual(["87"]);
    expect(numerosForaDaNoticia("3 cidades e 80% de umidade", NOTICIA.titulo + " " + NOTICIA.resumo)).toEqual([]);
    expect(numerosForaDaNoticia("R$ 1.200 a mais", "custa 1200 reais")).toEqual([]);
    const motivos = verificarTitulosDaCapa([bons[0], "9 em cada 10 casas sofrem com umidade", bons[2]], NOTICIA, { ramoSaude: false });
    expect(motivos.join("|")).toMatch(/título 2: o número 9, 10 não está na notícia/);
  });

  it("título igual à manchete ou repetido reprova", () => {
    const motivos = verificarTitulosDaCapa([NOTICIA.titulo + ".", bons[1], bons[1].toUpperCase()], NOTICIA, { ramoSaude: false });
    expect(motivos.join("|")).toMatch(/título 1: é igual à manchete/);
    expect(motivos.join("|")).toMatch(/título 3: repete outro título/);
  });

  it("em ramo de saúde, promessa de resultado reprova; fora dele, não", () => {
    const promessa = [bons[0], "Clareamento garante dentes brancos em uma sessão", bons[2]];
    expect(verificarTitulosDaCapa(promessa, NOTICIA, { ramoSaude: true }).join()).toMatch(/título 2: promessa de resultado/);
    expect(verificarTitulosDaCapa(promessa, NOTICIA, { ramoSaude: false }).join()).not.toMatch(/promessa/);
  });

  it("os títulos para a tela saem limpos, sem ponto final e sem repetir", () => {
    expect(limparTituloDaCapa("  Olha   isso.  ")).toBe("Olha isso");
    expect(titulosParaATela(["Olha isso.", "olha isso", "Outro título", ""])).toEqual(["Olha isso", "Outro título"]);
  });
});
