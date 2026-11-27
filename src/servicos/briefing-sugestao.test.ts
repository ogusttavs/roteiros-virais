/**
 * E76 PR 1: a conferência por código da sugestão de resposta do briefing. Os três primeiros casos são os dados que a sugestão
 * inventou na avaliação externa de 26/11/2026; os outros garantem que o dado que está nas fontes continua inteiro e que o
 * resto (código, endereço, colchete que a IA já escreveu) não vira colchete à toa.
 */
import { describe, expect, it } from "vitest";

import { conferirSugestao, MAXIMO_DE_TROCAS, montarFontesDaSugestao, quantidadesDoTexto } from "./briefing-sugestao";

const SEM_FONTE = "Somos uma importadora que cuida de tudo para a empresa que quer trazer produto de fora.";

describe("conferirSugestao: os três dados inventados da avaliação externa", () => {
  it('"5 empresas importaram nos últimos 6 meses" vira pergunta nos dois números', () => {
    const r = conferirSugestao("Com a gente, 5 empresas importaram nos últimos 6 meses.", SEM_FONTE);
    expect(r.texto).toBe("Com a gente, [quantas empresas?] importaram nos últimos [quantos meses?].");
    expect(r.trocados).toEqual(["5 empresas", "6 meses"]);
    expect(r.descartada).toBe(false);
  });

  it('"importar custa um terço na China" vira pergunta, com o "um" junto', () => {
    const r = conferirSugestao("Importar custa um terço na China, e a gente mostra a conta.", SEM_FONTE);
    expect(r.texto).toBe("Importar custa [quanto?] na China, e a gente mostra a conta.");
    expect(r.trocados).toEqual(["um terço"]);
  });

  it('"o Instagram foi lançado há dois meses com 4 posts" vira pergunta no tempo e na quantidade', () => {
    const r = conferirSugestao("O nosso Instagram foi lançado há dois meses com 4 posts.", SEM_FONTE);
    expect(r.texto).toBe("O nosso Instagram foi lançado há [quantos meses?] com [quantos posts?].");
    expect(r.trocados).toEqual(["dois meses", "4 posts"]);
  });

  it("os três juntos passam do limite de trocas: a sugestão é descartada", () => {
    const exemplo =
      "Nos últimos 6 meses, 5 empresas importaram com a gente. Importar custa um terço na China. O Instagram foi lançado há dois meses com 4 posts.";
    const r = conferirSugestao(exemplo, SEM_FONTE);
    expect(r.trocados.length).toBeGreaterThan(MAXIMO_DE_TROCAS);
    expect(r.descartada).toBe(true);
    expect(r.texto).toBe("");
  });
});

describe("conferirSugestao: o que está nas fontes continua", () => {
  it("o número que a pessoa escreveu numa resposta fica como está", () => {
    const fontes = montarFontesDaSugestao({ resposta: "Já atendemos 5 empresas que importam da China.", outrasRespostas: [], lidoDaMarca: [] });
    const r = conferirSugestao("Já ajudei 5 empresas a importar da China, do pedido até a entrega.", fontes);
    expect(r.texto).toBe("Já ajudei 5 empresas a importar da China, do pedido até a entrega.");
    expect(r.trocados).toEqual([]);
  });

  it("o que veio do site, marcado com a fonte, fica (ano e tempo de mercado)", () => {
    const fontes = montarFontesDaSugestao({
      resposta: "Cuidamos da importação inteira.",
      outrasRespostas: [{ resposta: "Atendemos empresas pequenas." }],
      lidoDaMarca: [{ texto: "Importadora que atua desde 2019, com 7 anos de experiência dos sócios em comércio exterior." }],
    });
    const r = conferirSugestao("Atuamos desde 2019 (do seu site), e os sócios têm 7 anos de comércio exterior (do seu site).", fontes);
    expect(r.trocados).toEqual([]);
  });

  it("o mesmo número escrito de outro jeito também vale (por extenso, com R$, com ponto de milhar)", () => {
    const fontes = "O sofá de 3 lugares custa 180 reais. Já limpamos 2.000 sofás.";
    const r = conferirSugestao("O sofá de três lugares custa R$ 180, e já limpamos 2 mil sofás.", fontes);
    expect(r.trocados).toEqual([]);
  });

  it("o preço solto na resposta (sem a palavra reais) vale para a sugestão com R$", () => {
    const r = conferirSugestao("O serviço mais pedido custa R$ 180.", "o serviço mais pedido custa 180");
    expect(r.trocados).toEqual([]);
  });
});

describe("conferirSugestao: o número da fonte com outra unidade ou outro objeto não vale", () => {
  it('"6 meses" contra "6 clientes" vira colchete', () => {
    const r = conferirSugestao("Em 6 meses de operação a gente cresceu.", "Temos 6 clientes fixos.");
    expect(r.texto).toBe("Em [quantos meses?] de operação a gente cresceu.");
  });

  it('"5 empresas" contra "5 países" vira colchete', () => {
    const r = conferirSugestao("Atendemos 5 empresas por mês.", "Trazemos produto de 5 países.");
    expect(r.texto).toBe("Atendemos [quantas empresas?] por mês.");
  });

  it('"16 meses" nas fontes não serve de fonte para "6 meses"', () => {
    const r = conferirSugestao("Faz 6 meses que abrimos.", "Faz 16 meses que estudamos o mercado.");
    expect(r.trocados).toEqual(["6 meses"]);
  });
});

describe("conferirSugestao: cada tipo de dado vira a pergunta certa", () => {
  it.each([
    ["É 30% mais barato que comprar aqui.", "É [quantos por cento?] mais barato que comprar aqui."],
    ["É trinta por cento mais barato.", "É [quantos por cento?] mais barato."],
    ["O frete sai por R$ 250 na média.", "O frete sai por [quanto, em reais?] na média."],
    ["A primeira importação foi em 2018, com um cliente só.", "A primeira importação foi em [que ano?], com um cliente só."],
    ["Já passamos de mais de 5 empresas atendidas.", "Já passamos de [quantas empresas?] atendidas."],
    ["Temos dezenas de clientes satisfeitos no Brasil.", "Temos [quantos clientes?] satisfeitos no Brasil."],
    ["As vendas dobraram desde que começamos a postar.", "As vendas [quanto cresceu?] desde que começamos a postar."],
    ["Há um ano a gente decidiu abrir a loja.", "Há [quantos anos?] a gente decidiu abrir a loja."],
    ["Respondemos em 24 horas qualquer pedido.", "Respondemos em [quantas horas?] qualquer pedido."],
    ["Atendemos de segunda a sexta, das 9:00 às 18:00, sem fila.", "Atendemos de segunda a sexta, das [que horário?] às [que horário?], sem fila."],
  ])("%s", (exemplo, esperado) => {
    expect(conferirSugestao(exemplo, SEM_FONTE).texto).toBe(esperado);
  });

  it("no começo da frase a pergunta começa com maiúscula", () => {
    expect(conferirSugestao("5 empresas já importaram com a gente.", SEM_FONTE).texto).toBe("[Quantas empresas?] já importaram com a gente.");
  });

  it("o que sobra sem palavra nenhuma fora dos colchetes é descartado", () => {
    const r = conferirSugestao("5 empresas.", SEM_FONTE);
    expect(r.descartada).toBe(true);
    expect(r.texto).toBe("");
  });
});

describe("conferirSugestao: o que não é dado fica como está", () => {
  it.each([
    "Vendemos B2B para lojas pequenas que querem trazer produto de fora.",
    "Um dia eu decidi largar o emprego e abrir a importadora.",
    "Uma vez por semana eu mostro um pedido chegando no galpão.",
    "Você encontra a gente em www.exemplo.com.br/2019 e no @importa_2019.",
    "É a 1ª importação de muita gente, então explico tudo com calma.",
    "Atendemos [quantas empresas vocês atenderam em 2026?] e contamos [conte um caso real de um cliente].",
  ])("%s", (exemplo) => {
    const r = conferirSugestao(exemplo, SEM_FONTE);
    expect(r.texto).toBe(exemplo);
    expect(r.trocados).toEqual([]);
  });

  it("sugestão vazia volta vazia, sem ser descartada", () => {
    expect(conferirSugestao("", SEM_FONTE)).toEqual({ texto: "", trocados: [], descartada: false });
  });

  it("conferir de novo o que já foi conferido não muda nada", () => {
    const uma = conferirSugestao("Com a gente, 5 empresas importaram nos últimos 6 meses.", SEM_FONTE);
    const duas = conferirSugestao(uma.texto, SEM_FONTE);
    expect(duas.texto).toBe(uma.texto);
    expect(duas.trocados).toEqual([]);
  });

  it("a pergunta de um colchete nas fontes nunca vira fonte de número", () => {
    const fontes = "Atendemos [quantas empresas vocês atenderam em 2026?].";
    expect(conferirSugestao("Em 2026 a gente dobrou de tamanho.", fontes).trocados).toContain("2026");
  });
});

describe("quantidadesDoTexto", () => {
  it("lê o valor e a classe com a escala, a moeda e a unidade", () => {
    const q = quantidadesDoTexto("R$ 2 mil por mês, 10k seguidores, 3 anos, 45%");
    expect(q.map((x) => [x.valor, x.classe])).toEqual([
      ["2000", "brl"],
      ["10000", ""],
      ["3", "t:ano"],
      ["45", "%"],
    ]);
  });

  it("lê o número por extenso composto", () => {
    expect(quantidadesDoTexto("vinte e cinco clientes e mil e quinhentos pedidos").map((x) => x.valor)).toEqual(["25", "1500"]);
  });
});
