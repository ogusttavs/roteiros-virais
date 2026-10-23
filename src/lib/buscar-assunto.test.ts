import { describe, expect, it } from "vitest";

import { ASSUNTOS_DO_CATALOGO, GRUPOS_DE_ASSUNTO, grupoDoAssunto } from "@/config/assuntos-do-catalogo";
import { encontrarProblemas } from "@/lib/regras-de-texto";
import { normalizarTexto } from "@/servicos/noticias-assuntos";

import { buscarAssuntos, ehNomeDeAssuntoDoCatalogo, MAXIMO_DE_SUGESTOES, singularDaPalavra } from "./buscar-assunto";

function slugs(consulta: string): string[] {
  return buscarAssuntos(consulta).map((a) => a.slug);
}

describe("o catálogo de assuntos", () => {
  it("tem algumas dezenas de assuntos, cada um num grupo que existe e com slug único", () => {
    expect(ASSUNTOS_DO_CATALOGO.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ASSUNTOS_DO_CATALOGO.map((a) => a.slug)).size).toBe(ASSUNTOS_DO_CATALOGO.length);
    const grupos = new Set(GRUPOS_DE_ASSUNTO.map((g) => g.slug));
    for (const assunto of ASSUNTOS_DO_CATALOGO) {
      expect(grupos.has(assunto.grupo), assunto.slug).toBe(true);
      expect(grupoDoAssunto(assunto).slug).toBe(assunto.grupo);
    }
  });

  it("cobre os oito grupos pedidos e todos têm assunto", () => {
    for (const grupo of GRUPOS_DE_ASSUNTO) {
      expect(ASSUNTOS_DO_CATALOGO.filter((a) => a.grupo === grupo.slug).length, grupo.slug).toBeGreaterThanOrEqual(5);
    }
    expect(GRUPOS_DE_ASSUNTO.map((g) => g.slug)).toEqual([
      "economia-e-negocios",
      "marketing-e-redes",
      "tecnologia-e-ia",
      "politica-e-eleicoes",
      "pessoas-publicas",
      "esporte",
      "datas-de-venda",
      "do-seu-ramo",
    ]);
  });

  it("cada assunto cabe no que a folha aceita: nome até 60 letras, de 3 a 6 palavras de até 40 letras, no máximo 8 contando o nome", () => {
    for (const assunto of ASSUNTOS_DO_CATALOGO) {
      expect(assunto.nome.length, assunto.slug).toBeLessThanOrEqual(60);
      expect(assunto.palavras.length, assunto.slug).toBeGreaterThanOrEqual(3);
      expect(assunto.palavras.length, assunto.slug).toBeLessThanOrEqual(6);
      for (const palavra of assunto.palavras) {
        expect(palavra.length, `${assunto.slug}: ${palavra}`).toBeGreaterThanOrEqual(2);
        expect(palavra.length, `${assunto.slug}: ${palavra}`).toBeLessThanOrEqual(40);
        expect(palavra, assunto.slug).toBe(palavra.trim());
      }
      const unicas = new Set([assunto.nome, ...assunto.palavras].map(normalizarTexto));
      expect(unicas.size, `${assunto.slug} repete uma palavra`).toBeLessThanOrEqual(8);
    }
  });

  it("nenhum texto do catálogo tem travessão, emoji, jargão (no que a pessoa lê) ou marca", () => {
    for (const assunto of ASSUNTOS_DO_CATALOGO) {
      // O que a pessoa lê (o nome e as palavras) não leva jargão; os sinônimos são só para a busca achar quem escreve "viral", e por isso só travessão e emoji contam neles.
      expect(encontrarProblemas([assunto.nome, ...assunto.palavras].join(" | ")), assunto.slug).toEqual([]);
      expect(encontrarProblemas(assunto.tambem.join(" | ")).filter((motivo) => !motivo.startsWith("jargao")), assunto.slug).toEqual([]);
      expect([assunto.nome, ...assunto.palavras, ...assunto.tambem].join(" ").toLowerCase()).not.toContain("orbita");
    }
    for (const grupo of GRUPOS_DE_ASSUNTO) expect(encontrarProblemas(grupo.nome), grupo.slug).toEqual([]);
  });

  it("pessoa pública entra pelo papel, não pelo nome", () => {
    const pessoas = ASSUNTOS_DO_CATALOGO.filter((a) => a.grupo === "pessoas-publicas");
    const texto = normalizarTexto(pessoas.map((a) => [a.nome, ...a.palavras, ...a.tambem].join(" ")).join(" "));
    for (const nome of ["lula", "bolsonaro", "tarcisio", "flavio", "neymar", "messi"]) expect(texto.split(" ")).not.toContain(nome);
  });

  it("digitar o nome de cada assunto traz esse assunto em primeiro", () => {
    for (const assunto of ASSUNTOS_DO_CATALOGO) {
      expect(slugs(assunto.nome)[0], assunto.nome).toBe(assunto.slug);
    }
  });
});

describe("buscarAssuntos: começo de palavra, sem acento e sem maiúscula", () => {
  it("consulta vazia, só pontuação ou uma letra sozinha não sugere nada", () => {
    expect(slugs("")).toEqual([]);
    expect(slugs("   ")).toEqual([]);
    expect(slugs("***")).toEqual([]);
    expect(slugs("e")).toEqual([]);
    expect(slugs("p")).toEqual([]);
  });

  it("o começo da palavra basta: 'eleic' acha Eleições, 'black' acha Black Friday, 'tik' acha TikTok", () => {
    expect(slugs("eleic")[0]).toBe("eleicoes");
    expect(slugs("black")[0]).toBe("black-friday");
    expect(slugs("tik")[0]).toBe("tiktok");
  });

  it("o meio da palavra não casa: 'friday' acha Black Friday, mas 'riday' não", () => {
    expect(slugs("friday")).toContain("black-friday");
    expect(slugs("riday")).toEqual([]);
  });

  it("com acento, sem acento e em maiúscula dão o mesmo", () => {
    expect(slugs("DÓLAR")).toEqual(slugs("dolar"));
    expect(slugs("Eleição")).toEqual(slugs("eleicao"));
    expect(slugs("inteligência artificial")).toEqual(slugs("INTELIGENCIA ARTIFICIAL"));
    expect(slugs("dolar")[0]).toBe("dolar-e-cambio");
  });

  it("acha pelas palavras de busca prontas e pelos sinônimos, não só pelo nome", () => {
    expect(slugs("selic")[0]).toBe("juros-e-selic");
    expect(slugs("ibovespa")[0]).toBe("bolsa-e-investimentos");
    expect(slugs("dentista")).toContain("saude-bucal");
    expect(slugs("zap")).toContain("whatsapp-para-negocios");
    expect(slugs("openai")).toContain("inteligencia-artificial");
  });

  it("acha pelo nome do grupo quando nada mais casa melhor", () => {
    const resultado = slugs("esporte");
    expect(resultado.length).toBeGreaterThan(0);
    expect(buscarAssuntos("esporte").every((a) => a.grupo === "esporte" || normalizarTexto(a.nome + a.palavras.join(" ") + a.tambem.join(" ")).includes("esporte"))).toBe(true);
  });

  it("várias palavras: todas precisam casar com o mesmo assunto, na ordem que for", () => {
    expect(slugs("preço da gasolina")[0]).toBe("combustivel-e-petrobras");
    expect(slugs("gasolina preço")[0]).toBe("combustivel-e-petrobras");
    expect(slugs("reforma tributaria")[0]).toBe("impostos-e-reforma-tributaria");
  });

  it("a palavra de ligação que ainda está sendo escrita não esvazia a lista", () => {
    expect(slugs("preço d")).toEqual(slugs("preço"));
    expect(slugs("preço d").length).toBeGreaterThan(0);
  });

  it("se nenhum assunto casa com todas as palavras, mostra os que casam com alguma ('dólar hoje' acha Dólar e câmbio)", () => {
    expect(slugs("dólar hoje")[0]).toBe("dolar-e-cambio");
    expect(slugs("quero saber da selic agora")[0]).toBe("juros-e-selic");
  });

  it("assunto que o catálogo não tem não acha nada (é aí que entra 'sugerir palavras')", () => {
    expect(slugs("zebra do circo")).toEqual([]);
    expect(slugs("xyzxyz")).toEqual([]);
  });

  it("devolve no máximo oito sugestões, mesmo com uma consulta que casa com muita coisa", () => {
    expect(buscarAssuntos("dia").length).toBeLessThanOrEqual(MAXIMO_DE_SUGESTOES);
    expect(buscarAssuntos("dia").length).toBeGreaterThan(0);
    expect(buscarAssuntos("dia", 3)).toHaveLength(3);
  });
});

describe("buscarAssuntos: plural e singular", () => {
  it("o plural com acento acha o singular: 'eleições' acha Eleições, 'jornais' vira jornal, 'paes' vira pao", () => {
    expect(slugs("eleições")[0]).toBe("eleicoes");
    expect(singularDaPalavra("eleicoes")).toBe("eleicao");
    expect(singularDaPalavra("jornais")).toBe("jornal");
    expect(singularDaPalavra("papeis")).toBe("papel");
    expect(singularDaPalavra("jovens")).toBe("jovem");
    expect(singularDaPalavra("caes")).toBe("caes");
  });

  it("o plural simples acha o singular: 'prefeitos', 'deputados' e 'candidatos' caem nos assuntos de pessoas", () => {
    expect(slugs("prefeitos")[0]).toBe("prefeitos-e-prefeitas");
    expect(slugs("deputados")[0]).toBe("deputados-e-senadores");
    expect(slugs("candidatos")[0]).toBe("candidatos-e-pre-candidatos");
  });

  it("o singular acha o plural: 'influenciador' acha Influenciadores, 'cripto' acha criptomoedas", () => {
    expect(slugs("influenciador")[0]).toBe("influenciadores-e-criadores");
    expect(slugs("cripto")[0]).toBe("criptomoedas");
  });

  it("palavra curta não perde letra: 'bar' não vira 'ba'", () => {
    expect(singularDaPalavra("bar")).toBe("bar");
    expect(slugs("bar")).toContain("delivery-e-restaurantes");
  });
});

describe("buscarAssuntos: termo curto inteiro", () => {
  it("'ia' acha os assuntos que têm a palavra IA inteira", () => {
    const resultado = buscarAssuntos("ia");
    expect(resultado.map((a) => a.slug)).toEqual(expect.arrayContaining(["inteligencia-artificial", "ia-no-trabalho"]));
    for (const assunto of resultado) {
      const palavras = normalizarTexto([assunto.nome, ...assunto.palavras, ...assunto.tambem].join(" ")).split(" ");
      expect(palavras, assunto.slug).toContain("ia");
    }
  });

  it("'ia' não acha palavra que só começa com ia, nem o fim de outra ('radia', 'iate')", () => {
    expect(slugs("ia")).not.toContain("delivery-e-restaurantes");
    expect(slugs("ia")).not.toContain("algoritmo-do-instagram");
  });

  it("'ms' e 'pt' (duas letras) só casam com palavra igual, e sem ela não mostram nada", () => {
    expect(slugs("ms")).toEqual([]);
    expect(slugs("pt")).toEqual([]);
    expect(slugs("mei")).toContain("mei-e-pequenas-empresas");
    expect(slugs("sus")).toContain("sus-e-planos-de-saude");
    expect(slugs("f1")).toContain("formula-1-e-automobilismo");
  });

  it("no meio de uma consulta maior, a palavra curta continua inteira ('ferramentas ia')", () => {
    expect(slugs("ferramentas ia")[0]).toBe("ia-no-trabalho");
  });
});

describe("ehNomeDeAssuntoDoCatalogo", () => {
  it("diz que sim para o nome exato, sem acento e em qualquer caixa, e não para o resto", () => {
    expect(ehNomeDeAssuntoDoCatalogo("Black Friday")).toBe(true);
    expect(ehNomeDeAssuntoDoCatalogo("  dolar e CAMBIO ")).toBe(true);
    expect(ehNomeDeAssuntoDoCatalogo("dólar")).toBe(false);
    expect(ehNomeDeAssuntoDoCatalogo("")).toBe(false);
  });
});
