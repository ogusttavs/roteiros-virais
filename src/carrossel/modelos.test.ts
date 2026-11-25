import { describe, expect, it } from "vitest";

import { carrosselAtivo, SEM_FOTO, TIPOS_DE_SLIDE, type SlideDoCarrossel, type TipoDeSlide } from "@/config/carrossel";

import { contraste, coresDoModo, corValida, fundoDoSlide, garantirLeitura, misturarOklab, modosDosSlides, piorFundoComImagem, slideHTML, tintaSobre, VEU_DO_FUNDO, type DadosDoModelo, type ModoDoSlide } from "./modelos";
import { distribuirFotos } from "./render";
import { crc32, montarZip } from "./zip";

const SEM_FONTES = { mona: null, mono: null };
const FOTO = { tipo: "image/png", base64: "AAAA" };

const SLIDE: Record<TipoDeSlide, SlideDoCarrossel> = {
  "capa-foto": { tipo: "capa-foto", rotulo: "Passo a passo", titulo: "Você escova do jeito <certo>?", sub: "4 passos & uma dica" },
  "capa-texto": { tipo: "capa-texto", rotulo: "Lista", titulo: "Três erros <b>comuns</b>", sub: "E o que fazer" },
  passo: { tipo: "passo", titulo: "Incline a escova", texto: "Num ângulo de 45 graus", numero: 2, de: 4 },
  item: { tipo: "item", rotulo: "Erro 1 de 3", titulo: "Esfregar sem esperar", texto: "Deixe o produto agir" },
  "antes-depois": { tipo: "antes-depois", titulo: "O que muda", antes: "Escovar com força", depois: "Movimentos curtos" },
  dado: { tipo: "dado", titulo: "", valor: "2", unidade: "min", frase: "é o tempo recomendado", fonte: "Associação Dentária Americana", referencia: "Recomendação, consultada em 2026" },
  "prova-fala": { tipo: "prova-fala", titulo: "", citacao: "Passei no rejunte e a sujeira saiu", quem: "Cliente de Campinas", contexto: "Comprou em outubro. Publicado com autorização." },
  "prova-resultado": { tipo: "prova-resultado", titulo: "O box depois de uma aplicação" },
  resumo: { tipo: "resumo", titulo: "Para guardar", linhas: ["Deixe agir antes", "Um produto por vez", "Banheiro aberto"] },
  chamada: { tipo: "chamada", titulo: "Quer saber se está certo?", texto: "Traga a sua escova", acoes: ["Salve para lembrar", "Mande para alguém"] },
  noticia: { tipo: "noticia", titulo: "Frente fria deixa a casa mais úmida", veiculo: "Jornal da Cidade", data: "24 nov. 2026" },
};

const dados = (tipo: TipoDeSlide, modo: ModoDoSlide, extra: Partial<DadosDoModelo> = {}): DadosDoModelo => ({
  slide: SLIDE[tipo],
  numero: 2,
  total: 5,
  cor: "#0e5a6a",
  arroba: "@clinica.exemplo",
  modo,
  foto: tipo === "capa-foto" || tipo === "prova-resultado" || tipo === "noticia" ? FOTO : null,
  fontes: SEM_FONTES,
  ...extra,
});

describe("as contas de cor", () => {
  it("valida a cor", () => {
    expect(corValida("#1f6feb")).toBe(true);
    expect(corValida("azul")).toBe(false);
    expect(corValida("#fff")).toBe(false);
  });

  it("a mistura em oklab bate com o color-mix do navegador (o meio entre branco e preto é o cinza #636363)", () => {
    expect(misturarOklab("#ffffff", 50, "#000000")).toBe("#636363");
    expect(misturarOklab("#0e5a6a", 100, "#ffffff")).toBe("#0e5a6a");
  });

  it("a tinta sobre a cor cheia é a de maior contraste: branca na cor escura, quase preta na amarela", () => {
    expect(tintaSobre("#0e5a6a")).toBe("#ffffff");
    expect(tintaSobre("#f5d90a")).toBe("#141414");
  });

  it("cor escura e laranja do desenho ficam como estão e leem bem em todo modo (acento 3:1, apoio da cor cheia 4:1, título 4,5:1)", () => {
    for (const cor of ["#0e5a6a", "#e8641c"]) {
      expect(garantirLeitura(cor), cor).toEqual({ cor, escureceu: false });
      const claro = coresDoModo(cor, "claro");
      const escuro = coresDoModo(cor, "escuro");
      const cheio = coresDoModo(cor, "marca");
      expect(contraste(claro.titulo, claro.fundo), cor).toBeGreaterThanOrEqual(4.5);
      expect(contraste(claro.texto, claro.fundo), cor).toBeGreaterThanOrEqual(4.5);
      expect(contraste(claro.acento, claro.fundo), cor).toBeGreaterThanOrEqual(3);
      expect(contraste(escuro.titulo, escuro.fundo), cor).toBeGreaterThanOrEqual(4.5);
      expect(contraste(escuro.acento, escuro.fundo), cor).toBeGreaterThanOrEqual(3);
      expect(contraste(cheio.titulo, cheio.fundo), cor).toBeGreaterThanOrEqual(4.5);
      expect(contraste(cheio.suave, cheio.fundo), cor).toBeGreaterThanOrEqual(4);
    }
    // os números do README para o verde-azulado: título 14,4 no claro e acento 8,5
    const claro = coresDoModo("#0e5a6a", "claro");
    expect(contraste(claro.titulo, claro.fundo)).toBeGreaterThan(13);
    expect(contraste(claro.acento, claro.fundo)).toBeGreaterThan(8);
  });

  it("uma cor amarela, clara demais, escurece até ler bem e avisa; depois de escurecer passa em todos os modos", () => {
    const amarelo = garantirLeitura("#f5d90a");
    expect(amarelo.escureceu).toBe(true);
    expect(amarelo.cor).not.toBe("#f5d90a");
    const claro = coresDoModo(amarelo.cor, "claro");
    const cheio = coresDoModo(amarelo.cor, "marca");
    expect(contraste(claro.acento, claro.fundo)).toBeGreaterThanOrEqual(3);
    expect(contraste(cheio.suave, cheio.fundo)).toBeGreaterThanOrEqual(4);
    expect(garantirLeitura(amarelo.cor).escureceu).toBe(false);
  });
});

describe("modosDosSlides", () => {
  const tipos = (...t: TipoDeSlide[]) => t.map((tipo) => ({ tipo }));
  it("segue o exemplo da dentista: capa com foto escura, passos alternando, dado e chamada na cor cheia", () => {
    expect(modosDosSlides(tipos("capa-foto", "passo", "passo", "dado", "passo", "passo", "chamada"))).toEqual(["escuro", "claro", "escuro", "marca", "claro", "escuro", "marca"]);
  });
  it("segue o exemplo da limpeza: capa sem foto na cor cheia, e nunca três iguais seguidos", () => {
    const m = modosDosSlides(tipos("capa-texto", "item", "item", "antes-depois", "item", "resumo", "chamada"));
    expect(m).toEqual(["marca", "claro", "escuro", "claro", "escuro", "claro", "marca"]);
    for (let i = 2; i < m.length; i += 1) expect(new Set([m[i], m[i - 1], m[i - 2]]).size).toBeGreaterThan(1);
  });
  it("uma capa com foto que perdeu a foto vai na cor cheia, como a capa de texto", () => {
    expect(modosDosSlides([{ tipo: "capa-foto", comFoto: false }, { tipo: "chamada" }])).toEqual(["marca", "marca"]);
  });
});

describe("slideHTML", () => {
  it("desenha os onze tipos nos três modos, escapa o texto e não leva nada do aplicativo nem a marca de foto vazia", () => {
    for (const tipo of TIPOS_DE_SLIDE) {
      for (const modo of ["claro", "escuro", "marca"] as const) {
        const html = slideHTML(dados(tipo, modo));
        expect(html, `${tipo} ${modo}`).toContain(`data-tipo="${tipo}"`);
        expect(html).toContain(`data-modo="${modo}"`);
        expect(html).toContain("--marca:#0e5a6a");
        expect(html).not.toContain("foto do cliente");
        expect(html).not.toMatch(/klaki|caveat/i);
        expect(html.toLowerCase()).not.toContain(["orb", "ita"].join(""));
        expect(html).not.toContain("<b>comuns</b>");
        expect(html).not.toContain("<certo>");
      }
    }
    expect(slideHTML(dados("capa-texto", "marca"))).toContain("&lt;b&gt;comuns&lt;/b&gt;");
  });

  it("a tinta sobre a cor cheia é calculada: branca na cor escura, quase preta na amarela", () => {
    expect(slideHTML(dados("dado", "marca"))).toContain("--sobre-marca:#ffffff");
    expect(slideHTML(dados("dado", "marca", { cor: "#f5d90a" }))).toContain("--sobre-marca:#141414");
  });

  it("o progresso nasce da posição e do total: um traço por slide, o de agora mais longo; sem progresso quando o total é 1", () => {
    const html = slideHTML(dados("passo", "claro", { numero: 2, total: 5 }));
    expect(html.match(/<i class="feito">/g)).toHaveLength(1);
    expect(html.match(/<i class="agora">/g)).toHaveLength(1);
    expect(html.match(/<i class="">/g)).toHaveLength(3);
    const noticia = slideHTML(dados("noticia", "escuro", { numero: 1, total: 1 }));
    expect(noticia).not.toContain("<i ");
    expect(noticia).toContain('data-total="1"');
  });

  it("o passo leva o número e o total que o código pôs; o passo com foto usa o modelo de foto", () => {
    expect(slideHTML(dados("passo", "claro"))).toContain("Passo 2 de 4");
    const comFoto = slideHTML(dados("passo", "claro", { foto: FOTO }));
    expect(comFoto).toContain("com-foto");
    expect(comFoto).toContain("data:image/png;base64,AAAA");
  });

  it("a capa com foto sem foto vira a capa de texto; com foto em modo claro a foto vai em cima", () => {
    const sem = slideHTML(dados("capa-foto", "escuro", { foto: null }));
    expect(sem).toContain('data-tipo="capa-texto"');
    expect(sem).toContain('data-modo="marca"');
    expect(slideHTML(dados("capa-foto", "escuro"))).toContain("foto-cheia");
    expect(slideHTML(dados("capa-foto", "claro"))).toContain("foto-topo");
  });

  it("o antes e depois com as duas fotos usa os dois lados; sem elas, os blocos de texto; a linha fixa de saúde só aparece quando o slide a leva", () => {
    const base = SLIDE["antes-depois"];
    expect(slideHTML(dados("antes-depois", "claro", { foto: FOTO, fotoDepois: FOTO }))).toContain("s-etiqueta");
    const texto = slideHTML(dados("antes-depois", "claro"));
    expect(texto).toContain("s-bloco depois");
    expect(texto).not.toContain("autorização do paciente");
    const saude = slideHTML(dados("antes-depois", "claro", { slide: { ...base, rodape: "Imagens publicadas com autorização do paciente. O resultado varia de pessoa para pessoa." } }));
    expect(saude).toContain("autorização do paciente");
  });

  it("a chamada mostra o @ grande só quando a marca tem @, e as duas ações", () => {
    expect(slideHTML(dados("chamada", "marca"))).toContain("s-arroba-grande");
    expect(slideHTML(dados("chamada", "marca", { arroba: "" }))).not.toContain("s-arroba-grande");
    expect(slideHTML(dados("chamada", "marca"))).toContain("Mande para alguém");
  });

  it("um foco inválido não entra no estilo da foto", () => {
    const html = slideHTML(dados("capa-foto", "escuro", { slide: { ...SLIDE["capa-foto"], foco: 'x" onerror="alert(1)' } }));
    expect(html).toContain("object-position:50% 50%");
    expect(html).not.toContain("onerror");
  });
});

describe("os fundos abstratos", () => {
  it("só os slides de texto nos modos claro e escuro levem fundo; nunca a cor cheia, o antes e depois, a capa, a chamada nem o passo com foto", () => {
    expect(fundoDoSlide("item", "claro", 2, false)).toBe(2);
    expect(fundoDoSlide("item", "escuro", 3, false)).toBe(3);
    expect(fundoDoSlide("resumo", "claro", 6, false)).toBe(0);
    expect(fundoDoSlide("item", "marca", 2, false)).toBeNull();
    expect(fundoDoSlide("antes-depois", "claro", 4, false)).toBeNull();
    expect(fundoDoSlide("capa-texto", "claro", 1, false)).toBeNull();
    expect(fundoDoSlide("chamada", "escuro", 7, false)).toBeNull();
    expect(fundoDoSlide("passo", "claro", 2, true)).toBeNull();
    expect(fundoDoSlide("passo", "claro", 2, false)).not.toBeNull();
    // claros pedem os fundos 1 a 3 e escuros, 4 a 6
    for (let n = 1; n <= 9; n += 1) {
      expect(fundoDoSlide("item", "claro", n, false)!).toBeLessThan(3);
      expect(fundoDoSlide("item", "escuro", n, false)!).toBeGreaterThanOrEqual(3);
    }
  });

  it("o fundo entra no slide de texto com o véu da cor do modo por cima, e o antes e depois fica liso", () => {
    const fundos = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
    const item = slideHTML(dados("item", "claro", { fundos }));
    expect(item).toContain("url(data:image/jpeg;base64,CCC)");
    expect(item).toContain("background-blend-mode:normal,color,normal");
    expect(item).toContain(`${Math.round(VEU_DO_FUNDO * 100)}%`);
    expect(slideHTML(dados("antes-depois", "claro", { fundos }))).not.toContain("base64,");
    expect(slideHTML(dados("item", "marca", { fundos }))).not.toContain("jpeg");
    expect(slideHTML(dados("item", "claro"))).not.toContain("jpeg");
  });

  it("o contraste continua passando no PIOR pixel que as imagens têm de verdade (o mais escuro dos claros, o mais claro dos escuros), com cores escura, laranja e a amarela já escurecida", () => {
    for (const cor of ["#0e5a6a", "#e8641c", garantirLeitura("#f5d90a").cor, "#c2185b", "#1f5c3a"]) {
      for (const modo of ["claro", "escuro"] as const) {
        const c = coresDoModo(cor, modo);
        const pior = piorFundoComImagem(cor, modo);
        expect(contraste(c.titulo, pior), `${cor} ${modo} título`).toBeGreaterThanOrEqual(4.5);
        expect(contraste(c.texto, pior), `${cor} ${modo} texto`).toBeGreaterThanOrEqual(4.5);
        expect(contraste(c.suave, pior), `${cor} ${modo} apoio (letra de 26 px ou mais: o piso da letra grande é 3, aqui 3,5)`).toBeGreaterThanOrEqual(3.5);
        expect(contraste(c.acento, pior), `${cor} ${modo} acento`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("distribuirFotos", () => {
  const fotos = [{ id: 10 }, { id: 11 }, { id: 12 }];
  const slide = (tipo: TipoDeSlide, extra = {}): SlideDoCarrossel => ({ tipo, titulo: "t", ...extra });
  it("entrega as fotos na ordem aos tipos que aceitam foto, e duas ao antes e depois", () => {
    const r = distribuirFotos([slide("capa-foto"), slide("antes-depois"), slide("dado"), slide("chamada")], fotos);
    expect(r.map((x) => [x.foto, x.fotoDepois])).toEqual([[10, null], [11, 12], [null, null], [null, null]]);
  });
  it("fotoId 0 deixa o slide sem foto de propósito e não gasta uma das que sobraram", () => {
    const r = distribuirFotos([slide("passo", { fotoId: SEM_FOTO }), slide("passo")], fotos);
    expect(r.map((x) => x.foto)).toEqual([null, 10]);
  });
  it("respeita a foto escolhida e ignora uma que não existe", () => {
    const r = distribuirFotos([slide("capa-foto", { fotoId: 12 }), slide("passo", { fotoId: 999 })], fotos);
    expect(r.map((x) => x.foto)).toEqual([12, 10]);
  });
  describe("em saúde, foto comum e foto de paciente separadas (E65 PR 5)", () => {
    const misturadas = [{ id: 10, dePaciente: false }, { id: 11, dePaciente: false }, { id: 12, dePaciente: true }, { id: 13, dePaciente: true }, { id: 14, dePaciente: true }];
    it("a comum nunca vai em antes-depois nem em resultado, e a de paciente só vai neles", () => {
      const r = distribuirFotos([slide("capa-foto"), slide("antes-depois"), slide("prova-resultado"), slide("passo"), slide("passo")], misturadas, true);
      expect(r.map((x) => [x.foto, x.fotoDepois])).toEqual([[10, null], [12, 13], [14, null], [11, null], [null, null]]);
    });
    it("só com foto comum, antes-depois e resultado ficam sem foto", () => {
      const r = distribuirFotos([slide("capa-foto"), slide("antes-depois"), slide("prova-resultado")], [{ id: 1, dePaciente: false }, { id: 2, dePaciente: false }, { id: 3, dePaciente: false }], true);
      expect(r.map((x) => [x.foto, x.fotoDepois])).toEqual([[1, null], [null, null], [null, null]]);
    });
    it("a foto que o slide aponta só vale se for do tipo certo; senão cai na distribuição", () => {
      const r = distribuirFotos([slide("antes-depois", { fotoId: 10, fotoDepoisId: 11 }), slide("capa-foto", { fotoId: 12 })], misturadas, true);
      expect(r.map((x) => [x.foto, x.fotoDepois])).toEqual([[12, 13], [10, null]]);
    });
    it("fora da saúde (sem separar), a foto vale para qualquer tipo, como sempre", () => {
      const r = distribuirFotos([slide("antes-depois")], [{ id: 1 }, { id: 2 }], false);
      expect(r.map((x) => [x.foto, x.fotoDepois])).toEqual([[1, 2]]);
    });
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
