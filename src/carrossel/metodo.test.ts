import { describe, expect, it } from "vitest";

import type { SlideDoCarrossel } from "@/config/carrossel";

import { larguraDaImagem } from "./fotos";
import { avisosDoMetodo, ehOProblema, capaTemPromessaConcreta, moldeVagoDaCapa, promessaDeContagem, rotularItens, verificarCapaVaga, verificarPromessaDaCapa } from "./metodo";
import { formatoDoCarrossel, formulasDeMaquinaDosSlides, slidesDaSaida, type SlideDaSaida } from "./regras";

const capa = (titulo: string, sub?: string): SlideDoCarrossel => ({ tipo: "capa-texto", titulo, ...(sub ? { sub } : {}) });
const item = (texto = "Um texto de explicação com mais de oito palavras para ensinar"): SlideDoCarrossel => ({ tipo: "item", titulo: "Um item", texto });
const passo = (texto = "Um texto de explicação com mais de oito palavras para ensinar"): SlideDoCarrossel => ({ tipo: "passo", titulo: "Um passo", texto });
const saidaBase: SlideDaSaida = { tipo: "item", rotulo: "", titulo: "", texto: "", antes: "", depois: "", valor: "", unidade: "", fonte: "", referencia: "", quem: "", contexto: "", linhas: [], acoes: [] };
const chamada: SlideDoCarrossel = { tipo: "chamada", titulo: "Quer?", texto: "Salve", acoes: ["a", "b"] };

describe("promessaDeContagem", () => {
  it("lê o número da capa por algarismo ou por extenso, só quando conta uma lista", () => {
    expect(promessaDeContagem("3 erros que estragam o seu sofá")).toEqual({ quantidade: 3, coisa: "erros" });
    expect(promessaDeContagem("Cinco passos para escovar certo")).toEqual({ quantidade: 5, coisa: "passos" });
    expect(promessaDeContagem("Três dicas simples")).toEqual({ quantidade: 3, coisa: "dicas" });
    expect(promessaDeContagem("7 principais erros de quem limpa o box")).toEqual({ quantidade: 7, coisa: "erros" });
    expect(promessaDeContagem("Uma das causas do mau hálito")).toBeNull();
    expect(promessaDeContagem("Um dos sinais de cárie que você ignora")).toBeNull();
    expect(promessaDeContagem("Escove por 2 minutos")).toBeNull();
    expect(promessaDeContagem("O dente inclinado em 45 graus")).toBeNull();
    expect(promessaDeContagem("Você escova do jeito certo?")).toBeNull();
  });
});

describe("verificarPromessaDaCapa", () => {
  it("aceita quando o número bate com os itens ou passos", () => {
    expect(verificarPromessaDaCapa([capa("3 erros comuns"), item(), item(), item(), chamada])).toEqual([]);
    expect(verificarPromessaDaCapa([capa("Cinco passos"), passo(), passo(), passo(), passo(), passo(), chamada])).toEqual([]);
  });
  it("aceita quando o número bate com os slides de conteúdo (item com dado no meio) e ignora o resumo", () => {
    const dado: SlideDoCarrossel = { tipo: "dado", titulo: "", valor: "2", frase: "x" };
    expect(verificarPromessaDaCapa([capa("3 dicas"), item(), dado, item(), chamada])).toEqual([]);
    const resumo: SlideDoCarrossel = { tipo: "resumo", titulo: "Guardar", linhas: ["a", "b", "c"] };
    expect(verificarPromessaDaCapa([capa("3 dicas"), item(), item(), item(), resumo, chamada])).toEqual([]);
  });
  it("reprova com o motivo quando a capa promete mais ou menos do que o carrossel traz", () => {
    const m = verificarPromessaDaCapa([capa("5 erros que..."), item(), item(), item(), chamada]).join();
    expect(m).toMatch(/a capa promete 5 erros e o carrossel traz 3/);
    expect(verificarPromessaDaCapa([capa("Dois passos"), passo(), passo(), passo(), chamada]).join()).toMatch(/promete 2 passos e o carrossel traz 3/);
  });
  it("com item e passo juntos, a promessa conta só a coisa de que a capa fala (casos reais da prova de 25/11)", () => {
    expect(verificarPromessaDaCapa([capa("2 causas do mau hálito"), item(), item(), passo(), passo(), chamada])).toEqual([]);
    expect(verificarPromessaDaCapa([capa("2 erros com o fio dental"), item(), item(), passo(), passo(), chamada])).toEqual([]);
    expect(verificarPromessaDaCapa([capa("3 erros com o fio dental"), item(), item(), chamada]).join()).toMatch(/promete 3 erros/);
    expect(verificarPromessaDaCapa([capa("2 passos para escovar"), item(), item(), item(), passo(), passo(), chamada])).toEqual([]);
    expect(verificarPromessaDaCapa([capa("3 passos para escovar"), item(), item(), item(), passo(), passo(), chamada]).join()).toMatch(/promete 3 passos e o carrossel traz 2 passos/);
    expect(verificarPromessaDaCapa([capa("2 dicas"), item(), item(), item(), passo(), passo(), chamada])).toEqual([]);
  });
  it("a linha de apoio também vale, e capa sem promessa de número passa", () => {
    expect(verificarPromessaDaCapa([capa("Seu dente escureceu?", "4 causas possíveis"), item(), item(), chamada]).join()).toMatch(/promete 4 causas/);
    expect(verificarPromessaDaCapa([capa("Seu dente escureceu?"), item(), chamada])).toEqual([]);
  });
});

describe("capa vaga", () => {
  it("reprova os moldes banidos, com o nome do molde", () => {
    expect(moldeVagoDaCapa("Tudo o que você precisa saber sobre clareamento")).toBe("promete tudo sobre o assunto");
    expect(moldeVagoDaCapa("O guia definitivo da limpeza do box")).toBe("promete tudo sobre o assunto");
    expect(moldeVagoDaCapa("A solução definitiva para o mofo")).toBe("guia definitivo");
    expect(moldeVagoDaCapa("O segredo que ninguém conta sobre o mofo")).toBe("revelação sem dizer qual");
    expect(moldeVagoDaCapa("O que os dentistas não te contam")).toBe("revelação sem dizer qual");
    expect(moldeVagoDaCapa("Você vai se chocar com isso")).toBe("revelação sem dizer qual");
    expect(moldeVagoDaCapa("A nova era da saúde bucal")).toBe("anúncio de uma era");
    expect(verificarCapaVaga([capa("Tudo sobre clareamento"), chamada]).join()).toMatch(/molde vago \(promete tudo sobre o assunto\)/);
  });
  it("não pega capas concretas", () => {
    for (const t of ["3 erros que estragam o seu sofá", "Seu dente escureceu? Nem sempre é sujeira", "Como tirar mancha de vinho do estofado", "O mofo voltou? Pode ser um destes 3 erros"]) {
      expect(moldeVagoDaCapa(t), t).toBeNull();
    }
    expect(verificarCapaVaga([capa("5 dicas para o box"), chamada])).toEqual([]);
  });
  it("sem número, pergunta nem verbo de ação a capa só gera aviso, nunca reprova", () => {
    expect(capaTemPromessaConcreta("Sobre mancha de vinho")).toBe(false);
    expect(capaTemPromessaConcreta("Estofado bonito")).toBe(false);
    expect(capaTemPromessaConcreta("3 erros no estofado")).toBe(true);
    expect(capaTemPromessaConcreta("Seu estofado está limpo?")).toBe(true);
    expect(capaTemPromessaConcreta("Evite manchas no estofado")).toBe(true);
    expect(capaTemPromessaConcreta("Como lavar o estofado")).toBe(true);
    expect(verificarCapaVaga([capa("Sobre mancha de vinho"), chamada])).toEqual([]);
    expect(avisosDoMetodo([capa("Sobre mancha de vinho"), item(), chamada], "Legenda diferente do título").join()).toMatch(/não tem número, pergunta nem verbo de ação/);
    expect(avisosDoMetodo([capa("3 erros no estofado"), item(), chamada], "Legenda diferente").join()).not.toMatch(/verbo de ação/);
  });
});

describe("avisos da legenda e da densidade", () => {
  it("avisa quando a legenda repete o título da capa, sem acento nem pontuação, e não quando abre com outra frase", () => {
    expect(avisosDoMetodo([capa("3 erros no estofado"), item(), chamada], "3 erros no estofado! Salve este post.").join()).toMatch(/repetindo o título da capa/);
    expect(avisosDoMetodo([capa("Seu dente escureceu?"), item(), chamada], "Seu dente escureceu? Veja as causas e salve.\n\nOutra linha").join()).toMatch(/repetindo o título/);
    expect(avisosDoMetodo([capa("3 erros no estofado"), item(), chamada], "Estofado sujo desanima. Salve este post e confira.").join()).not.toMatch(/repetindo/);
  });
  it("avisa item e passo com menos de 8 palavras, com o número dos slides, e nunca reprova", () => {
    const a = avisosDoMetodo([capa("3 erros no estofado"), item("Texto curto"), passo(), item("Também curto"), chamada], "Outra abertura aqui.").join();
    expect(a).toMatch(/Os slides 2, 4 têm pouco texto/);
    expect(avisosDoMetodo([capa("3 erros no estofado"), item("Só um"), chamada], "Outra").join()).toMatch(/O slide 2 tem pouco texto/);
    expect(avisosDoMetodo([capa("3 erros no estofado"), item(), passo(), chamada], "Outra").join()).not.toMatch(/pouco texto/);
  });
});

describe("rotularItens", () => {
  it("escreve o N de M do item por código e guarda a palavra que a IA escolheu", () => {
    const r = rotularItens([capa("x"), { ...item(), rotulo: "Erro 9 de 1" }, { ...item(), rotulo: "Sinal" }, passo(), { ...item(), rotulo: "" }, chamada]);
    expect(r.filter((s) => s.tipo === "item").map((s) => s.rotulo)).toEqual(["Erro 1 de 3", "Erro 2 de 3", "Erro 3 de 3"]);
    expect(r.find((s) => s.tipo === "passo")!.rotulo).toBeUndefined();
  });
  it("fica só com a primeira palavra do rótulo, para não estourar o limite (Sinal de alerta, Erro comum)", () => {
    const r = rotularItens([capa("x"), { ...item(), rotulo: "Sinal de alerta" }, { ...item(), rotulo: "Erro comum" }, { ...item(), rotulo: "Sinal" }, chamada]);
    expect(r.filter((s) => s.tipo === "item").map((s) => s.rotulo)).toEqual(["Sinal 1 de 3", "Sinal 2 de 3", "Sinal 3 de 3"]);
  });
});

describe("rotularItens, a série única (prova real de 25/11)", () => {
  const rotulos = (slides: SlideDoCarrossel[]) => rotularItens(slides).filter((s) => s.tipo === "item").map((s) => s.rotulo);
  it("pula artigo e palavra curta: 'A 4 de 4' não vira rótulo, a palavra seguinte ou Dica", () => {
    expect(rotulos([capa("x"), { ...item(), rotulo: "A 4 de 4" }, { ...item(), rotulo: "Sinal" }, chamada])).toEqual(["Sinal 1 de 2", "Sinal 2 de 2"]);
    expect(rotulos([capa("x"), { ...item(), rotulo: "A 4 de 4" }, { ...item(), rotulo: "O" }, chamada])).toEqual(["Dica 1 de 2", "Dica 2 de 2"]);
  });
  it("a série não sai misturada: a palavra do primeiro item vale para todos", () => {
    expect(rotulos([capa("x"), { ...item(), rotulo: "Causa 1 de 3" }, { ...item(), rotulo: "Causa 2 de 3" }, { ...item(), rotulo: "Erro 3 de 3" }, chamada])).toEqual(["Causa 1 de 3", "Causa 2 de 3", "Causa 3 de 3"]);
  });
  it("a capa que diz causas, erros, sinais ou mitos dá a palavra", () => {
    expect(rotulos([capa("3 causas do mau hálito"), { ...item(), rotulo: "Erro" }, { ...item(), rotulo: "Dica" }, chamada])).toEqual(["Causa 1 de 2", "Causa 2 de 2"]);
    expect(rotulos([capa("Dois mitos sobre clareamento"), item(), item(), chamada])).toEqual(["Mito 1 de 2", "Mito 2 de 2"]);
  });
  it("com um item só, sem '1 de 1'; com um passo só, sem 'de 1'", () => {
    expect(rotulos([capa("x"), { ...item(), rotulo: "Erro" }, chamada])).toEqual(["Erro"]);
    const um = slidesDaSaida([{ ...saidaBase, tipo: "passo", titulo: "t", texto: "um texto" }], { ramoSaude: false });
    expect(um[0].de).toBeUndefined();
    const dois = slidesDaSaida([{ ...saidaBase, tipo: "passo", titulo: "t", texto: "a" }, { ...saidaBase, tipo: "passo", titulo: "u", texto: "b" }], { ramoSaude: false });
    expect(dois.map((s) => s.de)).toEqual([2, 2]);
  });
});

describe("larguraDaImagem", () => {
  it("lê a largura do cabeçalho de png, jpeg e webp, e nulo se não reconhece", () => {
    const png = Buffer.alloc(40);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(800, 16);
    expect(larguraDaImagem(png)).toBe(800);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0]), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x07, 0x80, 0x04, 0x38]), Buffer.alloc(20)]);
    expect(larguraDaImagem(jpeg)).toBe(0x0438);
    const webp = Buffer.alloc(40);
    webp.write("RIFF", 0, "latin1");
    webp.write("WEBP", 8, "latin1");
    webp.write("VP8X", 12, "latin1");
    webp.writeUIntLE(1079, 24, 3);
    expect(larguraDaImagem(webp)).toBe(1080);
    expect(larguraDaImagem(Buffer.from("isso não é imagem de jeito nenhum, é só texto qualquer"))).toBeNull();
  });
});

describe("fórmulas com cara de máquina (o detector do roteiro, sem lista própria)", () => {
  it("acha a fórmula na capa, no meio e na chamada, e não pega texto de gente", () => {
    const limpo = [capa("3 erros no estofado", "Veja o que fazer em cada um."), item("Deixe o produto agir por dez minutos antes de esfregar o tecido com a escova"), chamada];
    expect(formulasDeMaquinaDosSlides(limpo, "")).toEqual([]);
    const comFormula = [capa("3 erros no estofado", "Não é sorte, é método."), item(), chamada];
    expect(formulasDeMaquinaDosSlides(comFormula, "").join()).toMatch(/R-COPY-26: o gancho usa a fórmula/);
    const noMeio = [capa("3 erros no estofado"), { ...item(), texto: "Você deixa o produto agir. E isso muda tudo." }, chamada];
    expect(formulasDeMaquinaDosSlides(noMeio, "").join()).toMatch(/R-COPY-26: o corpo usa a fórmula/);
  });
});

describe("o slide O problema (prompt 2.2.0, regra C)", () => {
  const problema: SlideDoCarrossel = { tipo: "item", rotulo: "O problema", titulo: "O vinho secou no sofá", texto: "A mancha escurece e você passa pano molhado, que só espalha." };

  it("não conta como um dos N da capa e não entra na numeração dos itens", () => {
    const slides = [capa("3 erros que estragam o seu sofá"), problema, item(), item(), item(), chamada];
    expect(ehOProblema(problema)).toBe(true);
    expect(ehOProblema(item())).toBe(false);
    expect(verificarPromessaDaCapa(slides)).toEqual([]);
    const rotulados = rotularItens(slides);
    expect(rotulados[1].rotulo).toBe("O problema");
    expect(rotulados.slice(2, 5).map((x) => x.rotulo)).toEqual(["Erro 1 de 3", "Erro 2 de 3", "Erro 3 de 3"]);
  });

  it("o formato do carrossel vem dos tipos (o problema não decide)", () => {
    expect(formatoDoCarrossel([capa("x"), problema, passo(), passo(), passo(), chamada])).toBe("passo a passo");
    expect(formatoDoCarrossel([capa("x"), problema, item(), item(), chamada])).toBe("lista");
    expect(formatoDoCarrossel([capa("x"), { tipo: "antes-depois", titulo: "t", antes: "a", depois: "d" }, chamada])).toBe("antes e depois");
    expect(formatoDoCarrossel([capa("x"), chamada])).toBeNull();
  });
});
