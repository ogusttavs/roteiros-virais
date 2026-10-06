import { describe, expect, it } from "vitest";

import { blocoDasNoticiasDoAssunto, montarFontesDosFatos } from "@/ia/prompts/roteiro";

import {
  casaComAssunto,
  desembrulharLink,
  enderecoCanonico,
  imagemDaPagina,
  juntarDuplicatas,
  lerDataDeFeed,
  normalizarTexto,
  primeiraImagemDoHtml,
  termosDoAssunto,
  trechoSemHtml,
  type NoticiaDeFeed,
} from "./noticias-assuntos";

function noticia(sobrescreve: Partial<NoticiaDeFeed>): NoticiaDeFeed {
  return { titulo: "Titulo", veiculo: "G1", url: "https://g1.globo.com/a", publicadoEm: null, imagemUrl: null, trecho: "", origem: "rss", ...sobrescreve };
}

describe("o assunto casa com um texto", () => {
  it("sem acento, sem maiúscula e por palavra inteira: 'eleição' casa com 'a Eleição de 2026' e não com 'reeleição'", () => {
    const termos = termosDoAssunto("eleição", []);
    expect(casaComAssunto("A Eleição de 2026 começa hoje", termos)).toBe(true);
    expect(casaComAssunto("ELEICAO municipal", termos)).toBe(true);
    expect(casaComAssunto("o prefeito quer a reeleição", termos)).toBe(false);
  });

  it("os termos dados valem junto com o texto, sem repetir e no máximo oito", () => {
    expect(termosDoAssunto("Política", ["eleição 2026", "Flávio", "política"])).toEqual(["politica", "eleicao 2026", "flavio"]);
    expect(termosDoAssunto("a", ["b", "c"])).toEqual([]);
    expect(termosDoAssunto("x1", Array.from({ length: 20 }, (_, i) => `termo${i}`))).toHaveLength(8);
  });

  it("um termo com duas palavras casa só com as duas juntas, na ordem", () => {
    const termos = termosDoAssunto("eleição 2026", []);
    expect(casaComAssunto("Debate da eleição 2026 em São Paulo", termos)).toBe(true);
    expect(casaComAssunto("2026 e a eleição", termos)).toBe(false);
  });

  it("normalizarTexto tira acento, pontuação e espaço de sobra", () => {
    expect(normalizarTexto("  Flávio  Bolsonaro, 2026!  ")).toBe("flavio bolsonaro 2026");
  });
});

describe("a junção de duplicatas", () => {
  it("o mesmo endereço (com parâmetros de campanha, www e barra no fim) é uma notícia só", () => {
    expect(enderecoCanonico("https://www.G1.globo.com/politica/noticia/x/?utm_source=a&utm_medium=b#topo")).toBe("https://g1.globo.com/politica/noticia/x");
    const juntas = juntarDuplicatas([noticia({ url: "https://g1.globo.com/a/" }), noticia({ url: "https://www.g1.globo.com/a?utm_source=x", titulo: "Outro título" })]);
    expect(juntas).toHaveLength(1);
  });

  it("o mesmo título de fontes diferentes vira uma só, e fica a do RSS direto com foto e hora (não a do Google News)", () => {
    const doGoogle = noticia({ titulo: "Lula sanciona a lei", url: "https://news.google.com/rss/articles/abc", origem: "google" });
    const doRss = noticia({ titulo: "Lula sanciona a lei!", url: "https://g1.globo.com/lei", imagemUrl: "https://img/a.jpg", publicadoEm: new Date("2026-10-06T12:00:00Z") });
    const juntas = juntarDuplicatas([doGoogle, doRss]);
    expect(juntas).toHaveLength(1);
    expect(juntas[0]).toMatchObject({ origem: "rss", imagemUrl: "https://img/a.jpg" });
  });

  it("notícias diferentes ficam todas, na ordem da primeira aparição", () => {
    const juntas = juntarDuplicatas([noticia({ titulo: "A", url: "https://x/a" }), noticia({ titulo: "B", url: "https://x/b" }), noticia({ titulo: "C", url: "https://x/c" })]);
    expect(juntas.map((n) => n.titulo)).toEqual(["A", "B", "C"]);
  });

  it("a Folha embrulha o link verdadeiro num redirecionador, depois de um asterisco", () => {
    const embrulhado = "https://redir.folha.com.br/redir/online/poder/rss091/*https://www1.folha.uol.com.br/colunas/x/2026/10/materia.shtml";
    expect(desembrulharLink(embrulhado)).toBe("https://www1.folha.uol.com.br/colunas/x/2026/10/materia.shtml");
    expect(enderecoCanonico(embrulhado)).toBe("https://www1.folha.uol.com.br/colunas/x/2026/10/materia.shtml");
    expect(desembrulharLink("https://g1.globo.com/a")).toBe("https://g1.globo.com/a");
  });
});

describe("a leitura do feed", () => {
  it("a data: o que o Date entende, e o dia e o mês em português da UOL", () => {
    expect(lerDataDeFeed("Tue, 06 Oct 2026 12:49:41 +0000")?.toISOString()).toBe("2026-10-06T12:49:41.000Z");
    expect(lerDataDeFeed("2026-10-06T10:01:46")).toBeInstanceOf(Date);
    expect(lerDataDeFeed("Ter, 06 Out 2026 10:00:09 -0300")?.toISOString()).toBe("2026-10-06T13:00:09.000Z");
    expect(lerDataDeFeed("isso nao e data")).toBeNull();
    expect(lerDataDeFeed(undefined)).toBeNull();
  });

  it("o trecho sai sem marca, sem 'Leia mais' e curto", () => {
    expect(trechoSemHtml("<img src='x.jpg'/><br/> Texto &amp; mais texto. &lt;a href=&quot;y&quot;&gt;Leia mais&lt;/a&gt; (10/06/2026 - 08h00)")).toBe("Texto & mais texto.");
    expect(trechoSemHtml("a".repeat(500), 100)).toHaveLength(103);
    expect(trechoSemHtml(null)).toBe("");
  });

  it("a foto: a primeira imagem do HTML do feed e o og:image da página, nas duas ordens de atributos, só http", () => {
    expect(primeiraImagemDoHtml("<p>oi</p><img src=\"https://s2-g1.glbimg.com/foto.jpg\" /><br/>")).toBe("https://s2-g1.glbimg.com/foto.jpg");
    expect(primeiraImagemDoHtml("sem imagem")).toBeNull();
    expect(imagemDaPagina('<head><meta property="og:image" content="https://i.exemplo/f.jpg?a=1&amp;b=2"></head>')).toBe("https://i.exemplo/f.jpg?a=1&b=2");
    expect(imagemDaPagina('<meta content="https://i.exemplo/g.jpg" property="og:image">')).toBe("https://i.exemplo/g.jpg");
    expect(imagemDaPagina('<meta property="og:image" content="javascript:alert(1)">')).toBeNull();
    expect(imagemDaPagina("<head></head>")).toBeNull();
  });
});

describe("as notícias do assunto como fonte do roteiro", () => {
  const noticias = [{ titulo: "Debate esquenta a eleição", veiculo: "G1", dia: "6 de outubro", resumo: "Os candidatos se enfrentaram." }];

  it("o bloco da entrada manda citar o veículo e o dia, nunca copiar a matéria, e só aceita opinião que a pessoa disser", () => {
    const bloco = blocoDasNoticiasDoAssunto(noticias)!;
    expect(bloco).toContain("FONTE de fato");
    expect(bloco).toContain("diga o veículo e o dia");
    expect(bloco).toContain("nunca copie o texto da matéria");
    expect(bloco).toContain("opinião sobre pessoa real só entra se a pessoa a disser no momento");
    expect(bloco).toContain("- G1, 6 de outubro: Debate esquenta a eleição. Os candidatos se enfrentaram.");
    expect(blocoDasNoticiasDoAssunto([])).toBeNull();
    expect(blocoDasNoticiasDoAssunto(undefined)).toBeNull();
  });

  it("entram nas fontes dos fatos (o que o verificador confere), e sem notícia nada aparece", () => {
    const base = { perfilCompilado: "perfil", camadaExclusiva: "", tema: "eleição" };
    const com = montarFontesDosFatos({ ...base, noticiasDoAssunto: noticias });
    expect(com).toContain("Notícias de hoje do assunto que a pessoa acompanha (dados de terceiros");
    expect(com).toContain("G1, 6 de outubro: Debate esquenta a eleição. Os candidatos se enfrentaram.");
    expect(montarFontesDosFatos(base)).not.toContain("Notícias de hoje do assunto");
  });
});
