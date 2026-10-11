/** As travas da pesquisa na hora (E54), em código puro: a unidade, a escala, a frase sem número, a fonte, a data, o corte e a conferência. */
import { describe, expect, it } from "vitest";

import type { LinhaDaBusca, PaginaDaBusca } from "@/ia/busca-na-web";
import { buscaSimulada } from "@/ia/mock-busca";

import {
  dadosForaDasFontes,
  ehAntigo,
  ehPrevisaoDePublico,
  lerDataDaPagina,
  marcadosDeInicio,
  montarAchados,
  motivoDeNaoBater,
  numeroComCaraDeDado,
  numerosDoTexto,
  numerosForaDoTrecho,
  OPCAO_SEM_OPINIAO,
  tokensNumericos,
  sanearConferencia,
} from "./conferencia-da-pesquisa";

const AGORA = new Date("2026-10-10T12:00:00Z");

describe("numerosDoTexto (valor, unidade e escala)", () => {
  it.each([
    ["alta de 4,5%", ["4.5|%"]],
    ["alta de 4,50%", ["4.5|%"]],
    ["alta de 4.5%", ["4.5|%"]],
    ["4,5 por cento", ["4.5|%"]],
    ["subiu 2 pontos percentuais", ["2|%"]],
    ["1.250 reclamações", ["1250|"]],
    ["R$ 1.250,75", ["1250.75|brl"]],
    ["1.250.000 de pessoas", ["1250000|"]],
    ["de 12 a 15 por cento", ["12|", "15|%"]],
    ["a escala 6x1", ["6|", "1|"]],
    ["em 2025 e 2026", ["2025|", "2026|"]],
    ["007 e 0,5", ["7|", "0.5|"]],
    ["0.500 kg", ["0.5|"]],
    ["R$ 2 milhões", ["2000000|brl"]],
    ["2,5 milhões de reais", ["2500000|brl"]],
    ["12 mil pessoas", ["12000|"]],
    ["US$ 5", ["5|usd"]],
    ["5 dólares", ["5|usd"]],
    ["12 meses", ["12|t:mes"]],
    ["3 anos", ["3|t:ano"]],
    ["sem número nenhum", []],
  ])("%s", (texto, esperado) => {
    expect(numerosDoTexto(texto)).toEqual(esperado);
  });

  it("o que não dá para ler sem chutar volta cru, nunca some", () => {
    expect(numerosDoTexto("1,2,3")).toEqual(["1,2,3|?"]);
    expect(numerosDoTexto("1,000,000")).toEqual(["1,000,000|?"]);
    expect(numerosDoTexto("10.05.2026")).toEqual(["10.05.2026|?"]);
    expect(numerosDoTexto("1.000,5.2")).toEqual(["1.000,5.2|?"]);
  });
});

describe("numerosForaDoTrecho (a trava 3, os números)", () => {
  it("confere com vírgula, ponto, % e por cento normalizados", () => {
    expect(numerosForaDoTrecho("A taxa foi de 4,5% em 12 meses.", "O índice ficou em 4,5% nos últimos 12 meses.", null)).toEqual([]);
    expect(numerosForaDoTrecho("Foram 1.250 queixas.", "Chegaram 1250 queixas ao órgão.", null)).toEqual([]);
    expect(numerosForaDoTrecho("Subiu 4,5%.", "Subiu 4,50 por cento.", null)).toEqual([]);
    expect(numerosForaDoTrecho("Custa R$ 1.250.", "Custa 1250 reais.", null)).toEqual([]);
  });

  it("devolve o número que o trecho não tem", () => {
    expect(numerosForaDoTrecho("O preço subiu 99% este ano.", "O sabão teve alta de 12% no ano.", null)).toEqual(["99|%"]);
    expect(numerosForaDoTrecho("A alta foi de 4,6%.", "A alta foi de 4,5%.", null)).toEqual(["4.6|%"]);
  });

  it("o número com a unidade ou a escala trocada não confere: 12% não é 12 meses", () => {
    expect(numerosForaDoTrecho("A inflação foi de 12%.", "A inflação ficou em 4,5% nos últimos 12 meses.", null)).toEqual(["12|%"]);
    expect(numerosForaDoTrecho("O preço subiu 100%.", "O preço foi de R$ 100 para R$ 150.", null)).toEqual(["100|%"]);
    expect(numerosForaDoTrecho("O fundo tem R$ 2 bilhões.", "O fundo tem R$ 2 milhões.", null)).toEqual(["2000000000|brl"]);
    expect(numerosForaDoTrecho("Custa US$ 5.", "Custa R$ 5.", null)).toEqual(["5|usd"]);
    expect(numerosForaDoTrecho("Foram 12 meses.", "Foram 12 anos.", null)).toEqual(["12|t:mes"]);
  });

  it("o ano da página vale só como ano e só quando o trecho não tem nenhum outro ano", () => {
    expect(numerosForaDoTrecho("Em 2026, a taxa ficou em 10%.", "A taxa ficou em 10% ao ano.", "2026")).toEqual([]);
    // o trecho fala de 2025: "em 2026" seria o ano da publicação no lugar do ano do dado
    expect(numerosForaDoTrecho("Em 2026 a taxa foi de 10%.", "Em 2025 a taxa foi de 10%.", "2026")).toEqual(["2026|"]);
    expect(numerosForaDoTrecho("Em 2024, a taxa ficou em 10%.", "A taxa ficou em 10% ao ano.", "2026")).toEqual(["2024|"]);
    // não é ano: o número solto igual ao ano da página não é perdoado, nem "2.026"
    expect(numerosForaDoTrecho("Foram 2026 casos.", "Foram muitos casos.", "2026")).toEqual(["2026|"]);
    expect(numerosForaDoTrecho("Em 2.026 casos.", "Foram muitos casos.", "2026")).toEqual(["2026|"]);
  });

  it("frase sem número confere nesta parte (o resto é do sentido)", () => {
    expect(numerosForaDoTrecho("A PEC tramita na Câmara.", "A PEC tramita na Câmara dos Deputados.", null)).toEqual([]);
  });
});

describe("motivoDeNaoBater (a trava 3, a frase sem número)", () => {
  it("a frase que combina com o trecho passa", () => {
    expect(motivoDeNaoBater("A PEC tramita na Câmara dos Deputados.", "A PEC que reduz a jornada tramita na Câmara dos Deputados.", {})).toBeNull();
    expect(
      motivoDeNaoBater("O Banco Central manteve a taxa Selic em 10,5% ao ano.", "O Copom decidiu manter a taxa Selic em 10,5% ao ano.", {
        titulo: "Histórico das taxas de juros | Banco Central",
        fonteNome: "Banco Central",
        host: "bcb.gov.br",
      }),
    ).toBeNull();
  });

  it("palavra de quantidade que o trecho não tem derruba: dobrou, metade, dez", () => {
    expect(motivoDeNaoBater("O preço dobrou este ano.", "O preço subiu neste ano.", {})).toBe("termo");
    expect(motivoDeNaoBater("A conta caiu pela metade no ano.", "A conta caiu no ano.", {})).toBe("termo");
    expect(motivoDeNaoBater("O preço dobrou neste ano.", "O preço dobrou neste ano segundo a fonte.", {})).toBeNull();
  });

  it("nome próprio ou sigla que o trecho, o título e a fonte não têm derruba: 'segundo o Banco Central' com citação do G1", () => {
    const frase = "Segundo o Banco Central, a taxa de juros subiu no mês.";
    const trecho = "A taxa de juros subiu no mês, informou a reportagem.";
    expect(motivoDeNaoBater(frase, trecho, { fonteNome: "G1", host: "g1.globo.com", titulo: "Juros sobem no mês | G1" })).toBe("termo");
    expect(motivoDeNaoBater(frase, trecho, { fonteNome: "Banco Central", host: "bcb.gov.br", titulo: "Juros | Banco Central" })).toBeNull();
    // "Brasil" não precisa estar no trecho
    expect(motivoDeNaoBater("A taxa de juros subiu no Brasil neste mês.", trecho, {})).toBeNull();
  });

  it("quase nada em comum com o trecho derruba", () => {
    expect(motivoDeNaoBater("A taxa de juros do cartão está alta.", "O índice de preços ao consumidor teve queda em abril.", {})).toBe("relacao");
  });

  it("o contrário do trecho derruba: alta x queda, aprovada x tramita", () => {
    expect(motivoDeNaoBater("A inflação de alimentos subiu em abril.", "A inflação de alimentos caiu em abril, segundo o IBGE.", { fonteNome: "IBGE", host: "ibge.gov.br" })).toBe("oposto");
    expect(motivoDeNaoBater("A inflação de alimentos caiu em abril.", "A inflação de alimentos subiu em abril, segundo o IBGE.", { fonteNome: "IBGE", host: "ibge.gov.br" })).toBe("oposto");
    expect(
      motivoDeNaoBater("A reforma tributária foi aprovada pelo Senado Federal.", "A reforma tributária tramita no Senado Federal e deve ser votada.", {}),
    ).toBe("oposto");
    // as duas direções no trecho: não dá para dizer que é o contrário
    expect(motivoDeNaoBater("A inflação de alimentos subiu em abril.", "A inflação de alimentos subiu em abril e caiu em maio, diz o IBGE.", { fonteNome: "IBGE", host: "ibge.gov.br" })).toBeNull();
  });
});

describe("lerDataDaPagina e ehAntigo (a trava 4)", () => {
  it.each([
    ["April 30, 2025", "2025-04-30"],
    ["april 3, 2026", "2026-04-03"],
    ["Sep 3, 2026", "2026-09-03"],
    ["Sept. 3, 2026", "2026-09-03"],
    ["3 April 2026", "2026-04-03"],
    ["2025-04-30", "2025-04-30"],
    ["2025-04-30T10:00:00Z", "2025-04-30"],
    ["30 de abril de 2025", "2025-04-30"],
    ["1 de março de 2026", "2026-03-01"],
    ["30/04/2025", "2025-04-30"],
    ["2 days ago", null],
    ["", null],
    [null, null],
    ["Smarch 31, 2025", null],
    ["constructor 3, 2025", null],
    ["February 31, 2025", null],
    ["2025-02-31", null],
    ["February 31, 1850", null],
  ])("%s", (texto, esperado) => {
    expect(lerDataDaPagina(texto as string | null)).toBe(esperado);
  });

  it("antigo é passar de doze meses (de 30 dias); sem data nunca é antigo", () => {
    expect(ehAntigo("2025-10-15", AGORA, 12)).toBe(false);
    expect(ehAntigo("2025-10-01", AGORA, 12)).toBe(true);
    expect(ehAntigo(null, AGORA, 12)).toBe(false);
  });
});

describe("montarAchados", () => {
  const pagina = (url: string, idade: string | null = "September 20, 2026", titulo = "Título da página"): PaginaDaBusca => ({ url, titulo, idade });
  const linha = (texto: string, url: string | null, trecho: string, titulo = "Título da página"): LinhaDaBusca => ({ texto, citacoes: url ? [{ url, titulo, trecho }] : [] });

  it("com a resposta simulada de todo dia: seis dados, a fonte oficial com nome primeiro, numerados de 1", () => {
    const { achados, descartes } = montarAchados(buscaSimulada({ sistemaEstavel: "", entrada: "x", maxBuscas: 5, dominios: [] }, AGORA), { agora: AGORA });
    expect(achados).toHaveLength(6);
    expect(achados.map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(descartes).toEqual({ semCitacao: 0, forDaLista: 0, enderecoInseguro: 0, numeroForaDoTrecho: 0, termoForaDoTrecho: 0, semRelacao: 0, sentidoOposto: 0, repetido: 0, semTexto: 0, alemDoLimite: 0 });
    const tipos = achados.map((a) => a.fonteTipo);
    expect(tipos.indexOf("imprensa")).toBeGreaterThan(tipos.lastIndexOf("oficial"));
    // dentro do mesmo grupo, o mais recente primeiro: o do gov.br de 20 dias, o do Banco Central (25) e o do IBGE (40)
    expect(achados.filter((a) => a.fonteTipo === "oficial").map((a) => a.fonteNome)).toEqual(["Governo federal", "Banco Central", "IBGE"]);
    expect(achados[0]).toMatchObject({ fonteTipo: "oficial", antigo: false, dataDaPagina: "2026-09-20" });
    expect(achados.find((a) => a.fonteNome === "IBGE")?.dataDaPagina).toBe("2026-08-31");
    expect(achados.every((a) => a.citacao.length > 0 && a.url.startsWith("https://"))).toBe(true);
  });

  it("trava 2: a frase sem citação da ferramenta cai", () => {
    const { achados, descartes } = montarAchados({ linhas: [linha("- Dizem por aí que o preço vai cair.", null, "")], paginas: [] }, { agora: AGORA });
    expect(achados).toEqual([]);
    expect(descartes.semCitacao).toBe(1);
  });

  it("trava 1: a citação de uma página fora da lista cai, mesmo que a ferramenta a tenha devolvido", () => {
    const url = "https://blog.exemplo.invalido/mercado";
    const { achados, descartes } = montarAchados({ linhas: [linha("- O mercado cresceu 8% em 2025.", url, "O mercado cresceu 8% em 2025.")], paginas: [pagina(url)] }, { agora: AGORA });
    expect(achados).toEqual([]);
    expect(descartes.forDaLista).toBe(1);
  });

  it("o domínio parecido não é da lista", () => {
    for (const url of ["https://ibge.gov.br.evil.com/x", "https://notg1.globo.com/x", "https://g1.globo.com.evil.com/x"]) {
      const { achados, descartes } = montarAchados({ linhas: [linha("- A taxa foi de 4,5%.", url, "A taxa foi de 4,5%.")], paginas: [] }, { agora: AGORA });
      expect(achados, url).toEqual([]);
      expect(descartes.forDaLista, url).toBe(1);
    }
  });

  it("o endereço que não é https seguro (http, porta, usuário na frente) cai, mesmo sendo de uma fonte da lista", () => {
    for (const url of ["http://www.ibge.gov.br/a", "https://www.ibge.gov.br:8443/a", "https://usuario@www.ibge.gov.br/a"]) {
      const { achados, descartes } = montarAchados({ linhas: [linha("- A taxa foi de 4,5%.", url, "A taxa foi de 4,5%.")], paginas: [pagina(url)] }, { agora: AGORA });
      expect(achados, url).toEqual([]);
      expect(descartes.enderecoInseguro, url).toBe(1);
    }
  });

  it("trava 3: o número que o trecho não tem derruba o dado, e a unidade trocada também", () => {
    const url = "https://g1.globo.com/economia/noticia/2026/05/sabao.ghtml";
    const inventado = montarAchados({ linhas: [linha("- O preço do sabão subiu 99% este ano.", url, "O sabão teve alta de 12% no ano.")], paginas: [pagina(url)] }, { agora: AGORA });
    expect(inventado.achados).toEqual([]);
    expect(inventado.descartes.numeroForaDoTrecho).toBe(1);
    const unidade = montarAchados(
      { linhas: [linha("- A inflação do sabão foi de 12% no período.", url, "A inflação do sabão ficou em 4,5% em 12 meses.")], paginas: [pagina(url)] },
      { agora: AGORA },
    );
    expect(unidade.achados).toEqual([]);
    expect(unidade.descartes.numeroForaDoTrecho).toBe(1);
  });

  it("trava 3: a frase sem número que o trecho não sustenta cai (nome trocado, 'dobrou', o contrário, sem relação)", () => {
    const g1 = "https://g1.globo.com/economia/noticia/2026/05/a.ghtml";
    const casos: [string, string, keyof ReturnType<typeof montarAchados>["descartes"]][] = [
      ["- Segundo o Banco Central, a taxa de juros subiu no mês.", "A taxa de juros subiu no mês, informou a reportagem.", "termoForaDoTrecho"],
      ["- O preço do sabão em pó dobrou neste ano.", "O preço do sabão em pó subiu neste ano.", "termoForaDoTrecho"],
      ["- A inflação de alimentos subiu em abril.", "A inflação de alimentos caiu em abril, diz o relatório.", "sentidoOposto"],
      ["- A taxa de juros do cartão está alta.", "O índice de preços ao consumidor teve queda em abril.", "semRelacao"],
    ];
    for (const [texto, trecho, contador] of casos) {
      const { achados, descartes } = montarAchados({ linhas: [linha(texto, g1, trecho, "Notícia | G1")], paginas: [pagina(g1)] }, { agora: AGORA });
      expect(achados, texto).toEqual([]);
      expect(descartes[contador], texto).toBe(1);
    }
  });

  it("com duas citações, a que confere sustenta o dado, e entre as que conferem vale a oficial", () => {
    const g1 = "https://g1.globo.com/economia/noticia/2026/05/a.ghtml";
    const ibge = "https://www.ibge.gov.br/explica/inflacao.php";
    const apenasG1: LinhaDaBusca = {
      texto: "- A inflação foi de 4,5% em 12 meses.",
      citacoes: [
        { url: g1, titulo: "Inflação | G1", trecho: "A inflação foi de 4,8% em 12 meses." },
        { url: ibge, titulo: "IPCA | IBGE", trecho: "A inflação foi de 4,5% em 12 meses." },
      ],
    };
    expect(montarAchados({ linhas: [apenasG1], paginas: [pagina(ibge), pagina(g1)] }, { agora: AGORA }).achados[0]).toMatchObject({ fonteNome: "IBGE", url: ibge });
    const as_duas: LinhaDaBusca = {
      texto: "- A inflação foi de 4,5% em 12 meses.",
      citacoes: [
        { url: g1, titulo: "Inflação | G1", trecho: "A inflação foi de 4,5% em 12 meses." },
        { url: ibge, titulo: "IPCA | IBGE", trecho: "A inflação foi de 4,5% em 12 meses." },
      ],
    };
    expect(montarAchados({ linhas: [as_duas], paginas: [pagina(ibge), pagina(g1)] }, { agora: AGORA }).achados[0]).toMatchObject({ fonteNome: "IBGE", fonteTipo: "oficial" });
  });

  it("trava 4: o dado de mais de doze meses vem antigo, sem data vem sem data, e só o que tem data e não é antigo entra marcado de início", () => {
    const antigo = "https://www.ibge.gov.br/a";
    const semData = "https://www.ibge.gov.br/b";
    const novo = "https://www.ibge.gov.br/c";
    const { achados } = montarAchados(
      {
        linhas: [
          linha("- A taxa de desemprego em 2024 foi de 5%.", antigo, "A taxa de desemprego em 2024 foi de 5%."),
          linha("- A taxa de desemprego agora é de 6%.", semData, "A taxa de desemprego agora é de 6%."),
          linha("- A taxa de desemprego neste mês é de 7%.", novo, "A taxa de desemprego neste mês é de 7%."),
        ],
        paginas: [pagina(antigo, "March 1, 2024"), pagina(semData, null), pagina(novo, "October 1, 2026")],
      },
      { agora: AGORA },
    );
    const porUrl = new Map(achados.map((a) => [a.url, a]));
    expect(porUrl.get(antigo)).toMatchObject({ antigo: true, dataDaPagina: "2024-03-01" });
    expect(porUrl.get(semData)).toMatchObject({ antigo: false, dataDaPagina: null, dataTexto: null });
    expect(porUrl.get(novo)).toMatchObject({ antigo: false, dataDaPagina: "2026-10-01" });
    // o antigo vai para o fim; o sem data fica depois dos que têm data
    expect(achados.map((a) => a.url)).toEqual([novo, semData, antigo]);
    expect(marcadosDeInicio(achados)).toEqual([1]);
  });

  it("a mesma frase não entra duas vezes; 4,5% e 45% são frases diferentes; a frase vem sem marcador nem travessão nem negrito", () => {
    const url = "https://www.ibge.gov.br/a";
    const travessao = String.fromCharCode(0x2014);
    const { achados, descartes } = montarAchados(
      {
        linhas: [
          linha(`- **A taxa de desemprego foi de 4,5%** ${travessao} segundo o IBGE.`, url, "A taxa de desemprego foi de 4,5%, informou o IBGE."),
          linha("* a taxa de desemprego foi de 4,5%  segundo o ibge.", url, "A taxa de desemprego foi de 4,5%, informou o IBGE."),
          linha("- A taxa de desemprego foi de 45%, segundo o IBGE.", url, "A taxa de desemprego foi de 45%, informou o IBGE."),
        ],
        paginas: [pagina(url)],
      },
      { agora: AGORA },
    );
    expect(achados.map((a) => a.texto)).toEqual(["A taxa de desemprego foi de 4,5%, segundo o IBGE.", "A taxa de desemprego foi de 45%, segundo o IBGE."]);
    expect(descartes.repetido).toBe(1);
  });

  it("o limite corta no que a tela mostra e diz quantos ficaram de fora", () => {
    const { achados, descartes } = montarAchados(buscaSimulada({ sistemaEstavel: "", entrada: "[mock:dados-demais]", maxBuscas: 5, dominios: [] }, AGORA), { agora: AGORA });
    expect(achados).toHaveLength(8);
    expect(descartes.alemDoLimite).toBe(4);
    expect(achados.map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("o órgão público genérico (gov.br) é chamado pelo próprio endereço e fica depois da imprensa", () => {
    const procon = "https://www.procon.sp.gov.br/reclamacoes";
    const g1 = "https://g1.globo.com/economia/noticia/2026/05/reclamacoes.ghtml";
    const { achados } = montarAchados(
      {
        linhas: [
          linha("- Foram 300 reclamações de consumidores no mês.", procon, "Foram 300 reclamações de consumidores no mês."),
          linha("- Foram 280 reclamações de consumidores no mês.", g1, "Foram 280 reclamações de consumidores no mês."),
        ],
        paginas: [pagina(procon), pagina(g1)],
      },
      { agora: AGORA },
    );
    expect(achados.map((a) => a.fonteNome)).toEqual(["G1", "procon.sp.gov.br"]);
    expect(achados[1]).toMatchObject({ fonteTipo: "oficial" });
  });

  it("a linha de 'não encontrei', a curta e a que traz endereço ou menção não viram dado", () => {
    const { achados, descartes } = montarAchados(
      {
        linhas: [
          { texto: "Não encontrei dado confiável sobre isso.", citacoes: [] },
          { texto: "- Sim.", citacoes: [] },
          { texto: "- Veja mais em https://exemplo.invalido/pagina sobre o preço.", citacoes: [] },
          { texto: "- Fale com @alguem sobre a taxa de juros deste mês.", citacoes: [] },
        ],
        paginas: [],
      },
      { agora: AGORA },
    );
    expect(achados).toEqual([]);
    expect(descartes.semTexto).toBe(4);
  });
});

describe("marcadosDeInicio", () => {
  it("só os que têm data e não são antigos, no máximo três", () => {
    const base = { texto: "t", fonteNome: "IBGE", fonteTipo: "oficial" as const, url: "https://x", titulo: null, dataTexto: null, citacao: "c" };
    const achados = [
      { ...base, id: 1, dataDaPagina: "2026-09-01", antigo: false },
      { ...base, id: 2, dataDaPagina: null, antigo: false },
      { ...base, id: 3, dataDaPagina: "2024-01-01", antigo: true },
      { ...base, id: 4, dataDaPagina: "2026-08-01", antigo: false },
      { ...base, id: 5, dataDaPagina: "2026-07-01", antigo: false },
      { ...base, id: 6, dataDaPagina: "2026-06-01", antigo: false },
    ];
    expect(marcadosDeInicio(achados)).toEqual([1, 4, 5]);
  });
});

describe("sanearConferencia", () => {
  const achados = [
    { id: 1, texto: "A taxa Selic ficou em 10,5% ao ano.", citacao: "O Copom manteve a Selic em 10,5% ao ano." },
    { id: 3, texto: "A PEC tramita na Câmara.", citacao: "A PEC tramita na Câmara dos Deputados." },
  ];
  const base = { premissa: { situacao: "nao_confere" as const, aviso: "O que você escreveu não bate com as fontes: é uma PEC.", anguloSugerido: "Explique a PEC.", achadoIds: [3] }, perguntaDePosicao: null };

  it("mantém o aviso quando um dado que existe o sustenta", () => {
    expect(sanearConferencia(base, achados).premissa).toEqual({
      situacao: "nao_confere",
      aviso: "O que você escreveu não bate com as fontes: é uma PEC.",
      anguloSugerido: "Explique a PEC.",
      achadoIds: [3],
    });
  });

  it("sem dado que o sustente, com id que não existe ou com aviso vazio, volta a 'confere': nunca acusar sem prova", () => {
    expect(sanearConferencia({ ...base, premissa: { ...base.premissa, achadoIds: [] } }, achados).premissa).toMatchObject({ situacao: "confere", aviso: null, achadoIds: [] });
    expect(sanearConferencia({ ...base, premissa: { ...base.premissa, achadoIds: [99] } }, achados).premissa.situacao).toBe("confere");
    expect(sanearConferencia({ ...base, premissa: { ...base.premissa, aviso: "   " } }, achados).premissa.situacao).toBe("confere");
  });

  it("o aviso com um número que os dados citados não têm cai: 'a fonte mostra 8%' quando a fonte mostra 10,5%", () => {
    const comNumero = { ...base, premissa: { ...base.premissa, aviso: "O que você escreveu não bate com as fontes: a Selic está em 8% ao ano.", achadoIds: [1] } };
    expect(sanearConferencia(comNumero, achados).premissa.situacao).toBe("confere");
    const certo = { ...base, premissa: { ...base.premissa, aviso: "O que você escreveu não bate com as fontes: a Selic está em 10,5% ao ano.", achadoIds: [1] } };
    expect(sanearConferencia(certo, achados).premissa.situacao).toBe("nao_confere");
  });

  it("o aviso e o ângulo com endereço ou menção não passam (conteúdo de página no nosso texto)", () => {
    const comEndereco = { ...base, premissa: { ...base.premissa, aviso: "O que você escreveu não bate com as fontes: veja https://exemplo.invalido/x." } };
    expect(sanearConferencia(comEndereco, achados).premissa.situacao).toBe("confere");
    const comMencao = { ...base, premissa: { ...base.premissa, anguloSugerido: "Chame @alguem para explicar." } };
    expect(sanearConferencia(comMencao, achados).premissa.anguloSugerido).toBeNull();
  });

  it("limpa o aviso e corta nas pontas", () => {
    const comprido = `O que você escreveu não bate com as fontes: ${"x".repeat(600)}`;
    expect(sanearConferencia({ ...base, premissa: { ...base.premissa, aviso: comprido } }, achados).premissa.aviso!.length).toBeLessThanOrEqual(400);
  });

  it("a pergunta de posição termina sempre na opção de não opinar, com no máximo três antes dela", () => {
    const pergunta = (opcoes: string[]) => sanearConferencia({ ...base, perguntaDePosicao: { pergunta: "De quem é a culpa?", opcoes } }, achados).perguntaDePosicao;
    expect(pergunta(["A", "B", "C", "D", "E", "F"])?.opcoes).toEqual(["A", "B", "C", OPCAO_SEM_OPINIAO]);
    expect(pergunta(["Prefiro não dar opinião", "A", "B"])?.opcoes).toEqual(["A", "B", OPCAO_SEM_OPINIAO]);
    expect(pergunta(["Só uma"])?.opcoes).toEqual(["Só uma", OPCAO_SEM_OPINIAO]);
    expect(pergunta([])).toBeNull();
    expect(pergunta(["", "  "])).toBeNull();
    expect(sanearConferencia({ ...base, perguntaDePosicao: { pergunta: "  ", opcoes: ["A", "B"] } }, achados).perguntaDePosicao).toBeNull();
  });

  it("'sem premissa' e 'confere' nunca levam aviso nem dado", () => {
    const { premissa } = sanearConferencia({ premissa: { situacao: "sem_premissa", aviso: "ignorado", anguloSugerido: "ignorado", achadoIds: [1] }, perguntaDePosicao: null }, achados);
    expect(premissa).toEqual({ situacao: "sem_premissa", aviso: null, anguloSugerido: null, achadoIds: [] });
  });
});

describe("numeroComCaraDeDado (o que o roteiro com pesquisa tem de provar nas fontes)", () => {
  const tem = (texto: string) => tokensNumericos(texto).some((tk) => numeroComCaraDeDado(tk));

  it.each([
    ["alta de 4,5%", true],
    ["custa R$ 89", true],
    ["custa 89 reais", true],
    ["US$ 12", true],
    ["são 5.000 clientes", true],
    ["desde 2019", true],
    ["chegou a 10k seguidores", true],
    ["chegou a 10 mil seguidores", true],
    ["chegou a 2mi de views", true],
    ["em 3 passos", false],
    ["por 15 minutos", false],
    ["são 999 clientes", false],
    ["são 1000 clientes", true],
    ["em 12 meses", false],
    ["grave em 1080p", false],
    ["resolução 1080x1920", false],
    ["ligue (11) 98765-4321", false],
    ["grave em 4k", false],
    ["grave em 8k", false],
  ])("%s", (texto, esperado) => {
    expect(tem(texto)).toBe(esperado);
  });

  it("o número que não deu para ler conta como dado (nunca some em silêncio)", () => {
    expect(tem("de 1,2,3 em diante")).toBe(true);
  });
});

describe("tokensNumericos: as escalas coladas", () => {
  it.each([
    ["10k", "10000|"],
    ["2,5 mi", "2500000|"],
    ["1 bi", "1000000000|"],
    ["R$ 3k", "3000|brl"],
  ])("%s", (texto, chave) => {
    expect(tokensNumericos(texto).map((tk) => tk.chave)).toEqual([chave]);
  });
});

describe("dadosForaDasFontes", () => {
  const FONTES = "Perfil: vende por 89 reais. IBGE: a inflação foi de 4,5% em 12 meses e 1,25 mil reais por mês. Folha: a alta foi de 6,2%.";

  it("confere: o que está nas fontes, do mesmo jeito, não volta", () => {
    expect(dadosForaDasFontes("A inflação foi de 4,5% e o kit custa R$ 89.", FONTES)).toEqual([]);
    expect(dadosForaDasFontes("São R$ 1.250 por mês.", FONTES)).toEqual([]);
  });

  it("devolve cada número como a pessoa o leu, sem repetir", () => {
    expect(dadosForaDasFontes("Subiu 37%, depois 37%, e custa R$ 120 em 2019.", FONTES)).toEqual(["37%", "R$ 120", "2019"]);
  });

  it("a quantidade por extenso volta quando as fontes não têm a palavra", () => {
    expect(dadosForaDasFontes("Trinta por cento dos clientes dobraram o gasto.", FONTES)).toEqual(expect.arrayContaining(["por cento", "trinta", "dobraram"]));
    expect(dadosForaDasFontes("Metade das lojas faz isso.", `${FONTES} Metade das lojas faz isso.`)).toEqual([]);
  });

  it("o 'mil' que acompanha o dígito é escala, não quantidade por extenso", () => {
    expect(dadosForaDasFontes("São 1,25 mil reais por mês.", FONTES)).toEqual([]);
    // o número com a escala, escrito como a pessoa o leu, é o que volta (e a palavra "milhões" não volta de novo como extenso)
    expect(dadosForaDasFontes("São 5 milhões de pessoas.", FONTES)).toEqual(["5 milhões"]);
    expect(dadosForaDasFontes("Chegou a 10k seguidores.", FONTES)).toEqual(["10k"]);
    expect(dadosForaDasFontes("Faturou R$ 2,5 milhões.", FONTES)).toEqual(["R$ 2,5 milhões"]);
  });

  it("'em cada' e 'por cento' sem fonte voltam, com fonte não", () => {
    expect(dadosForaDasFontes("7 em cada 10 donos concordam.", FONTES)).toContain("em cada");
    expect(dadosForaDasFontes("7 em cada 10 donos concordam.", `${FONTES} 7 em cada 10 donos concordam.`)).toEqual([]);
  });

  it("dois a dez por extenso são passos, não dado", () => {
    expect(dadosForaDasFontes("Faça em três passos e repita duas vezes, dez minutos.", FONTES)).toEqual([]);
  });
});

describe("ehPrevisaoDePublico", () => {
  it.each([
    "Vão dizer que é caro.",
    "O público vai reclamar do preço.",
    "As pessoas vão te perguntar o motivo.",
    "Os seguidores vão comentar.",
    "Vão te responder que não funciona.",
    "A galera vai duvidar.",
    "Os clientes vão cobrar o prazo.",
    "Vocês vão dizer isso.",
  ])("previsão: %s", (texto) => {
    expect(ehPrevisaoDePublico(texto)).toBe(true);
  });

  it.each([
    "Vai funcionar no meu caso?",
    "Isso vale para mim?",
    "Quanto custa por mês?",
    "Pode aparecer a dúvida sobre o prazo.",
    "A loja vai abrir cedo.",
  ])("não é previsão: %s", (texto) => {
    expect(ehPrevisaoDePublico(texto)).toBe(false);
  });
});
