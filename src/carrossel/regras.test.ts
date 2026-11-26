import { describe, expect, it } from "vitest";

import { LINHA_FIXA_ANTES_DEPOIS_SAUDE, type SlideDoCarrossel } from "@/config/carrossel";

import { verificarPromessaDaCapa } from "./metodo";
import { excessoDoCampo, motivoDoCampo, normalizarHashtags, promessaEmSaude, slidesComExcessoPequeno, slidesComFoto, slidesDaSaida, verificarLegenda, verificarLimitesDosSlides, verificarOrdemDosSlides, type SlideDaSaida } from "./regras";

const s = (tipo: SlideDoCarrossel["tipo"], extra: Partial<SlideDoCarrossel> = {}): SlideDoCarrossel => {
  const base: Record<string, Partial<SlideDoCarrossel>> = {
    "capa-foto": { titulo: "Um título curto" },
    "capa-texto": { titulo: "Um título curto" },
    passo: { titulo: "Um título curto", texto: "Um texto curto aqui" },
    item: { titulo: "Um título curto", texto: "Um texto curto aqui" },
    "antes-depois": { titulo: "Um título curto", antes: "Como estava antes", depois: "Como ficou depois" },
    dado: { titulo: "", valor: "42", unidade: "%", frase: "erram por falta de tempo", fonte: "Sebrae", referencia: "Pesquisa de 2025" },
    "prova-fala": { titulo: "", citacao: "Relaxa que sai sim", quem: "Ana", contexto: "Cliente. Publicado com autorização." },
    "prova-resultado": { titulo: "Um resultado" },
    resumo: { titulo: "Para guardar", linhas: ["um", "dois", "três"] },
    chamada: { titulo: "Quer saber mais?", texto: "Salve este post", acoes: ["Salve", "Mande"] },
    noticia: { titulo: "Uma notícia", veiculo: "Jornal", data: "24 nov. 2026" },
  };
  return { tipo, titulo: "", ...base[tipo], ...extra };
};
const palavras = (n: number) => Array.from({ length: n }, () => "ok").join(" ");

describe("verificarOrdemDosSlides", () => {
  it("aceita capa, meio misturado e chamada", () => {
    expect(verificarOrdemDosSlides([s("capa-texto"), s("passo"), s("item"), s("passo"), s("chamada")], 5)).toEqual([]);
  });
  it("reprova quantidade errada, capa fora do lugar e chamada fora do lugar", () => {
    expect(verificarOrdemDosSlides([s("passo"), s("capa-texto"), s("chamada"), s("item")], 5).join("|")).toMatch(/4 slides.*5/);
    const m = verificarOrdemDosSlides([s("passo"), s("capa-texto"), s("chamada"), s("item")], 4).join("|");
    expect(m).toMatch(/primeiro slide/);
    expect(m).toMatch(/último slide/);
    expect(m).toMatch(/"capa-texto" só pode ser o primeiro/);
    expect(m).toMatch(/"chamada" só pode ser o último/);
  });
  it("aceita dois seguidos e reprova três seguidos do mesmo tipo", () => {
    expect(verificarOrdemDosSlides([s("capa-texto"), s("item"), s("item"), s("passo"), s("chamada")], 5)).toEqual([]);
    expect(verificarOrdemDosSlides([s("capa-texto"), s("item"), s("item"), s("item"), s("chamada")], 5).join("|")).toMatch(/3 slides seguidos do tipo "item"/);
  });

  // T114 (ensaio de 26/11/2026): "3 sinais" em 5 slides falhava sempre, porque só cabem 3 slides no meio e a regra dos três seguidos obrigava a trocar um item por outro tipo.
  it("os itens da lista que a capa promete podem vir seguidos: a escova em 5 slides sai sem nenhum motivo", () => {
    const vazio = { rotulo: "", titulo: "", texto: "", antes: "", depois: "", valor: "", unidade: "", fonte: "", referencia: "", quem: "", contexto: "", linhas: [] as string[], acoes: [] as string[] };
    const saida: SlideDaSaida[] = [
      { ...vazio, tipo: "capa-texto", titulo: "Escova de dente: 3 sinais de que está na hora de trocar", texto: "Para você conferir a sua hoje" },
      { ...vazio, tipo: "item", rotulo: "Sinal", titulo: "As cerdas abriram", texto: "Cerda aberta para os lados não alcança a linha da gengiva e deixa a placa no lugar." },
      { ...vazio, tipo: "item", rotulo: "Sinal", titulo: "Faz três meses", texto: "Mesmo com cara de nova, a escova usada todo dia perde a firmeza das cerdas com o tempo." },
      { ...vazio, tipo: "item", rotulo: "Sinal", titulo: "Você ficou gripado", texto: "Depois de uma gripe ou de uma dor de garganta, troque a escova para começar do zero." },
      { ...vazio, tipo: "chamada", titulo: "Marque a sua avaliação", texto: "Mande uma mensagem pelo botão do perfil.", acoes: ["Salve para lembrar", "Mande para alguém"] },
    ];
    const slides = slidesDaSaida(saida, { ramoSaude: true });
    expect(verificarOrdemDosSlides(slides, 5)).toEqual([]);
    expect(verificarPromessaDaCapa(slides)).toEqual([]);
    expect(verificarLimitesDosSlides(slides, { ramoSaude: true, fotosPrometidas: 0, fotosDePacientePrometidas: 0 })).toEqual([]);
    expect(slides.slice(1, 4).map((x) => x.rotulo)).toEqual(["Sinal 1 de 3", "Sinal 2 de 3", "Sinal 3 de 3"]);
  });
  it("vale para os passos e para a lista de 7 slides, com o slide que sobra fora da lista", () => {
    const quatroCoisas = s("capa-texto", { titulo: "Gengiva que sangra: 4 coisas que você precisa saber" });
    expect(verificarOrdemDosSlides([quatroCoisas, s("item"), s("item"), s("item"), s("item"), s("resumo"), s("chamada")], 7)).toEqual([]);
    const passos = s("capa-texto", { titulo: "Um título curto", sub: "Cinco passos para escovar certo" });
    expect(verificarOrdemDosSlides([passos, s("passo"), s("passo"), s("passo"), s("passo"), s("passo"), s("chamada")], 7)).toEqual([]);
  });
  it("a regra dos três seguidos continua valendo para os outros tipos, para a capa sem número e para o que passa do número da capa", () => {
    const tresSinais = s("capa-texto", { titulo: "Escova de dente: 3 sinais de que está na hora de trocar" });
    expect(verificarOrdemDosSlides([tresSinais, s("dado"), s("dado"), s("dado"), s("chamada")], 5).join("|")).toMatch(/3 slides seguidos do tipo "dado"/);
    expect(verificarOrdemDosSlides([s("capa-texto", { titulo: "Sinais de que está na hora de trocar a escova" }), s("item"), s("item"), s("item"), s("chamada")], 5).join("|")).toMatch(/3 slides seguidos do tipo "item"/);
    expect(verificarOrdemDosSlides([tresSinais, s("item"), s("item"), s("item"), s("item"), s("resumo"), s("chamada")], 7).join("|")).toMatch(/slides 2 a 5: 4 slides seguidos do tipo "item"/);
  });
});

describe("T77: o excesso pequeno de tamanho na 2ª tentativa", () => {
  const o = { ramoSaude: false };
  const tolera = { ramoSaude: false, tolerarExcessoPequeno: true };
  it("até 3 palavras a mais (e até 20% de caracteres) deixa de reprovar quando tolerado; sem tolerar, reprova como sempre", () => {
    const slide = [s("chamada", { texto: palavras(22) })];
    expect(verificarLimitesDosSlides(slide, o).join()).toMatch(/passou 2 palavras/);
    expect(verificarLimitesDosSlides(slide, tolera)).toEqual([]);
    expect(slidesComExcessoPequeno(slide, o)).toEqual([1]);
    expect(verificarLimitesDosSlides([s("passo", { texto: palavras(33) })], tolera)).toEqual([]);
  });
  it("4 palavras a mais, ou caracteres demais, continuam reprovando", () => {
    expect(verificarLimitesDosSlides([s("passo", { texto: palavras(34) })], tolera).join()).toMatch(/passou 4 palavras/);
    expect(verificarLimitesDosSlides([s("passo", { titulo: "x".repeat(58) })], tolera).join()).toMatch(/passou 10 caracteres/);
    expect(verificarLimitesDosSlides([s("passo", { titulo: "x".repeat(57) })], tolera)).toEqual([]);
    expect(slidesComExcessoPequeno([s("passo", { texto: palavras(34) })], o)).toEqual([]);
  });
  it("a linha do resumo até 20% acima passa; mais que isso, a quantidade de itens e o valor do dado não", () => {
    expect(verificarLimitesDosSlides([s("resumo", { linhas: ["a", "b", "x".repeat(54)] })], tolera)).toEqual([]);
    expect(verificarLimitesDosSlides([s("resumo", { linhas: ["a", "b", "x".repeat(55)] })], tolera).join()).toMatch(/linhas 3/);
    expect(verificarLimitesDosSlides([s("resumo", { linhas: ["a", "b"] })], tolera).join()).toMatch(/tem 2 itens/);
    expect(verificarLimitesDosSlides([s("dado", { valor: "1234567" })], tolera).join()).toMatch(/valor/);
  });
  it("o excesso pequeno não leva junto o que continua reprovando (vazio, fonte, ano, saúde, ordem do tipo)", () => {
    expect(verificarLimitesDosSlides([s("item", { texto: "" })], tolera).join()).toMatch(/sem texto/);
    expect(verificarLimitesDosSlides([s("dado", { fonte: null })], tolera).join()).toMatch(/sem a fonte/);
    expect(verificarLimitesDosSlides([s("passo", { texto: `${palavras(31)} garantido` })], { ramoSaude: true, tolerarExcessoPequeno: true }).join()).toMatch(/prometer/);
    expect(verificarLimitesDosSlides([s("prova-fala")], { ramoSaude: true, tolerarExcessoPequeno: true }).join()).toMatch(/saúde/);
  });
});

describe("os limites de cada campo", () => {
  it("passo: título até 8 palavras e texto até 30; um a mais reprova", () => {
    expect(verificarLimitesDosSlides([s("passo", { titulo: palavras(8), texto: palavras(30) })], { ramoSaude: false })).toEqual([]);
    expect(verificarLimitesDosSlides([s("passo", { titulo: palavras(9) })], { ramoSaude: false }).join()).toMatch(/título, passou 1 palavra \(o limite é 8\)/);
    expect(verificarLimitesDosSlides([s("passo", { texto: palavras(31) })], { ramoSaude: false }).join()).toMatch(/texto, passou 1 palavra \(o limite é 30\)/);
  });
  it("o teto de caracteres vale além das palavras (uma palavra enorme não cabe)", () => {
    expect(verificarLimitesDosSlides([s("passo", { titulo: "x".repeat(49) })], { ramoSaude: false }).join()).toMatch(/título, passou 1 caracteres \(o limite é 48\)/);
    expect(verificarLimitesDosSlides([s("dado", { valor: "1234567" })], { ramoSaude: false }).join()).toMatch(/valor, passou 1 caracteres/);
  });
  it("os limites mudam com o tipo, e o passo e o antes e depois com foto têm limites menores", () => {
    expect(verificarLimitesDosSlides([s("capa-texto", { titulo: palavras(12), sub: palavras(14) })], { ramoSaude: false })).toEqual([]);
    expect(verificarLimitesDosSlides([s("capa-texto", { rotulo: palavras(4) })], { ramoSaude: false }).join()).toMatch(/rótulo, passou 1 palavra/);
    expect(verificarLimitesDosSlides([s("chamada", { texto: palavras(21) })], { ramoSaude: false }).join()).toMatch(/limite é 20/);
    const comFoto = [s("capa-foto"), s("passo", { titulo: palavras(7), texto: palavras(20) }), s("chamada")];
    expect(verificarLimitesDosSlides(comFoto, { ramoSaude: false, fotosPrometidas: 2 }).join()).toMatch(/slide 2.*título, passou 1 palavra \(o limite é 6\)/);
    expect(verificarLimitesDosSlides(comFoto, { ramoSaude: false, fotosPrometidas: 1 }).join()).not.toMatch(/slide 2/);
    expect(slidesComFoto(comFoto, 2)).toEqual([true, true, false]);
    expect(slidesComFoto([s("antes-depois")], 1)).toEqual([false]);
    expect(slidesComFoto([s("antes-depois")], 2)).toEqual([true]);
  });
  it("campo obrigatório vazio reprova; o opcional vazio passa", () => {
    expect(verificarLimitesDosSlides([s("item", { texto: "" })], { ramoSaude: false }).join()).toMatch(/sem texto/);
    expect(verificarLimitesDosSlides([s("capa-texto", { sub: "", rotulo: "" })], { ramoSaude: false })).toEqual([]);
  });
  it("o resumo leva de 3 a 5 linhas curtas e a chamada leva exatamente 2 ações", () => {
    expect(verificarLimitesDosSlides([s("resumo", { linhas: ["a", "b"] })], { ramoSaude: false }).join()).toMatch(/linhas tem 2 itens, o pedido é de 3 a 5/);
    expect(verificarLimitesDosSlides([s("resumo", { linhas: ["a", "b", "c", "d", "e", "f"] })], { ramoSaude: false }).join()).toMatch(/tem 6 itens/);
    expect(verificarLimitesDosSlides([s("resumo", { linhas: ["a", "b", palavras(8)] })], { ramoSaude: false }).join()).toMatch(/linhas 3 passa de 7 palavras/);
    expect(verificarLimitesDosSlides([s("chamada", { acoes: ["só uma"] })], { ramoSaude: false }).join()).toMatch(/acoes tem 1 itens, o pedido é de 2/);
  });
  it("dado exige a fonte, o ano na referência e número no valor", () => {
    expect(verificarLimitesDosSlides([s("dado")], { ramoSaude: false })).toEqual([]);
    expect(verificarLimitesDosSlides([s("dado", { fonte: null })], { ramoSaude: false }).join()).toMatch(/sem a fonte/);
    expect(verificarLimitesDosSlides([s("dado", { referencia: "Pesquisa" })], { ramoSaude: false }).join()).toMatch(/precisa ter o ano/);
    expect(verificarLimitesDosSlides([s("dado", { valor: "muitos" })], { ramoSaude: false }).join()).toMatch(/tem número/);
  });
  it("em ramo de saúde só a fala de cliente (depoimento) fica de fora; antes-depois e prova-resultado valem", () => {
    expect(verificarLimitesDosSlides([s("prova-fala")], { ramoSaude: true }).join()).toMatch(/saúde/);
    expect(verificarLimitesDosSlides([s("antes-depois")], { ramoSaude: true })).toEqual([]);
    expect(verificarLimitesDosSlides([s("prova-resultado")], { ramoSaude: true, fotosPrometidas: 0, fotosDePacientePrometidas: 1 })).toEqual([]);
  });
  it("em saúde, antes-depois e prova-resultado só contam com foto de paciente, a comum não basta (E65 PR 5)", () => {
    expect(verificarLimitesDosSlides([s("prova-resultado")], { ramoSaude: true, fotosPrometidas: 3, fotosDePacientePrometidas: 0 }).join()).toMatch(/só usam foto de paciente/);
    expect(verificarLimitesDosSlides([s("antes-depois")], { ramoSaude: true, fotosPrometidas: 2, fotosDePacientePrometidas: 1 }).join()).toMatch(/só usam foto de paciente/);
    expect(verificarLimitesDosSlides([s("antes-depois")], { ramoSaude: true, fotosPrometidas: 0, fotosDePacientePrometidas: 2 })).toEqual([]);
    expect(verificarLimitesDosSlides([s("capa-foto")], { ramoSaude: true, fotosPrometidas: 0, fotosDePacientePrometidas: 2 }).join()).toMatch(/pedem foto/);
    expect(slidesComFoto([s("antes-depois")], 2, 0)).toEqual([false]);
    expect(slidesComFoto([s("antes-depois")], 0, 2)).toEqual([true]);
  });
  it("capa-foto e prova-resultado só existem com foto", () => {
    expect(verificarLimitesDosSlides([s("capa-foto"), s("prova-resultado")], { ramoSaude: false, fotosPrometidas: 1 }).join()).toMatch(/2 slides pedem foto.*tem 1/);
    expect(verificarLimitesDosSlides([s("capa-foto"), s("prova-resultado")], { ramoSaude: false, fotosPrometidas: 2 })).toEqual([]);
    expect(verificarLimitesDosSlides([s("capa-texto")], { ramoSaude: false, fotosPrometidas: 0 })).toEqual([]);
  });
  it("prova-fala só vale com uma frase que o cliente disse de verdade, com pelo menos 4 palavras", () => {
    const falasDoCliente = 'Relaxa que sai sim\n"é só passar o pano"';
    const fala = (citacao: string) => [s("prova-fala", { citacao })];
    expect(verificarLimitesDosSlides(fala("Relaxa que sai sim"), { ramoSaude: false, falasDoCliente })).toEqual([]);
    expect(verificarLimitesDosSlides(fala("Melhor serviço da cidade"), { ramoSaude: false, falasDoCliente }).join()).toMatch(/disse de verdade/);
    expect(verificarLimitesDosSlides(fala("que sai sim"), { ramoSaude: false, falasDoCliente }).join()).toMatch(/pelo menos 4 palavras/);
  });
});

describe("excessoDoCampo e motivoDoCampo", () => {
  it("conta palavras nos campos de texto e caracteres nos curtos, e usa o limite com foto quando o slide leva foto", () => {
    expect(excessoDoCampo("passo", "texto", palavras(33), false)).toEqual({ tipo: "palavras", n: 3, limite: 30 });
    expect(excessoDoCampo("passo", "texto", palavras(19), true)).toEqual({ tipo: "palavras", n: 1, limite: 18 });
    expect(excessoDoCampo("passo", "texto", palavras(19), false)).toBeNull();
    expect(excessoDoCampo("dado", "valor", "1234567", false)).toEqual({ tipo: "caracteres", n: 1, limite: 6 });
    expect(excessoDoCampo("passo", "titulo", "", false)).toMatchObject({ tipo: "vazio" });
    expect(excessoDoCampo("passo", "sub", "qualquer", false)).toBeNull();
    expect(motivoDoCampo("passo", "texto", "ok", false)).toBeNull();
  });
});

describe("slidesDaSaida", () => {
  const vazio: SlideDaSaida = { tipo: "item", rotulo: "", titulo: "", texto: "", antes: "", depois: "", valor: "", unidade: "", fonte: "", referencia: "", quem: "", contexto: "", linhas: [], acoes: [] };
  const saida = (tipo: SlideDaSaida["tipo"], extra: Partial<SlideDaSaida> = {}): SlideDaSaida => ({ ...vazio, tipo, ...extra });

  it("numera os passos e conta quantos são; leva cada campo para o nome do desenho e descarta o que o tipo não usa", () => {
    const r = slidesDaSaida(
      [saida("capa-texto", { rotulo: "Lista", titulo: " Capa ", texto: "Apoio", fonte: "lixo" }), saida("passo", { titulo: "a", texto: "b" }), saida("dado", { valor: "2", unidade: "min", texto: "frase", fonte: "ADA", referencia: "2026" }), saida("passo", { titulo: "c", texto: "d" }), saida("chamada", { titulo: "t", texto: "x", acoes: ["a", " ", "b"] })],
      { ramoSaude: false },
    );
    expect(r[0]).toEqual({ tipo: "capa-texto", titulo: "Capa", rotulo: "Lista", sub: "Apoio" });
    expect(r[1]).toMatchObject({ tipo: "passo", numero: 1, de: 2, texto: "b" });
    expect(r[3]).toMatchObject({ numero: 2, de: 2 });
    expect(r[2]).toEqual({ tipo: "dado", titulo: "", valor: "2", unidade: "min", frase: "frase", fonte: "ADA", referencia: "2026" });
    expect(r[4]).toMatchObject({ acoes: ["a", "b"] });
  });
  it("em ramo de saúde o antes e depois e o resultado levam a linha fixa; fora dela, não", () => {
    const lista = [saida("antes-depois", { titulo: "t", antes: "a", depois: "d" }), saida("prova-resultado", { titulo: "r" })];
    expect(slidesDaSaida(lista, { ramoSaude: true }).map((x) => x.rodape)).toEqual([LINHA_FIXA_ANTES_DEPOIS_SAUDE, LINHA_FIXA_ANTES_DEPOIS_SAUDE]);
    expect(slidesDaSaida(lista, { ramoSaude: false }).map((x) => x.rodape)).toEqual([undefined, undefined]);
  });
  it("a fala de cliente sempre termina com a autorização, escrita por código (e sem repetir se a IA já a escreveu)", () => {
    const um = slidesDaSaida([saida("prova-fala", { texto: "frase", quem: "Ana", contexto: "Cliente" })], { ramoSaude: false })[0];
    expect(um.contexto).toBe("Cliente. Publicado com autorização.");
    const dois = slidesDaSaida([saida("prova-fala", { texto: "frase", quem: "Ana", contexto: "Cliente. Publicado com autorização." })], { ramoSaude: false })[0];
    expect(dois.contexto).toBe("Cliente. Publicado com autorização.");
    expect(slidesDaSaida([saida("prova-fala", { texto: "frase", quem: "Ana" })], { ramoSaude: false })[0].contexto).toBe("Publicado com autorização.");
  });
});

describe("legenda e hashtags", () => {
  it("confere o tamanho da legenda e de 3 a 5 hashtags", () => {
    expect(verificarLegenda("Salve este post", ["#a", "#b", "#c"])).toEqual([]);
    expect(verificarLegenda("", ["#a", "#b", "#c"]).join()).toMatch(/vazia/);
    expect(verificarLegenda(Array.from({ length: 151 }, () => "x").join(" "), ["#a", "#b", "#c"]).join()).toMatch(/151 palavras/);
    expect(verificarLegenda("ok", ["#a", "#b"]).join()).toMatch(/hashtags: 2/);
    expect(verificarLegenda("ok", ["a", "b", "c", "d", "e", "f"]).join()).toMatch(/hashtags: 6/);
  });
  it("normaliza: põe o #, tira espaço e repetição", () => {
    expect(normalizarHashtags(["dicas", "#Dicas", " # nova ", "##x"])).toEqual(["#dicas", "#nova", "#x"]);
  });
});

describe("promessaEmSaude: a frase que desmente a promessa passa, a promessa de verdade reprova (B1, 26/11/2026)", () => {
  it("negação antes ou depois do trecho não é promessa", () => {
    for (const frase of [
      "O clareamento não dura para sempre",
      "Resultado garantido não existe",
      "Gengivite não se cura sozinha",
      "Nunca prometa clareamento definitivo",
      "É mito que o clareamento dura para sempre",
      "Dizer que o resultado dura para sempre é mito",
    ]) {
      expect(promessaEmSaude(frase), frase).toBeNull();
    }
  });
  it("a promessa de verdade continua reprovando, inclusive com negação de outra coisa", () => {
    expect(promessaEmSaude("O resultado dura para sempre")).toBe("para sempre");
    expect(promessaEmSaude("Clareamento garantido")).toBe("garantido");
    expect(promessaEmSaude("Não se preocupe, o resultado é garantido")).toBe("garantido");
    expect(promessaEmSaude("Escove bem. Seu sorriso fica branco para sempre")).toBe("fica branco");
    // uma frase negada e uma promessa na mesma fala: a promessa pega
    expect(promessaEmSaude("Não dura para sempre sozinho, mas com a gente é garantido")).toBe("garantido");
  });
});

describe("promessaEmSaude", () => {
  it("acha resultado, cura, garantia e prazo, devolvendo o trecho como a pessoa escreveu", () => {
    expect(promessaEmSaude("Com o clareamento, o dente volta ao branco em uma sessão.")).toBe("volta ao branco");
    expect(promessaEmSaude("O resultado sai Em 7 dias")).toBe("resultado sai Em 7 dias");
    expect(promessaEmSaude("Tratamento com resultado garantido")).toBe("resultado garantido");
    expect(promessaEmSaude("A gente cura a sua dor")).toBe("cura");
    expect(promessaEmSaude("Fica 100% limpo")).toBe("100%");
    expect(promessaEmSaude("Clareamento definitivo")).toBe("Clareamento definitivo");
    expect(promessaEmSaude("Sem dor nenhuma")).toBe("Sem dor nenhuma");
    expect(promessaEmSaude("Dentes brancos em 7 dias")).toBe("Dentes brancos em 7 dias");
    expect(promessaEmSaude("Nós garantimos o resultado")).toBe("garantimos");
    expect(promessaEmSaude("Uma solução definitiva para o seu sorriso")).toBe("solução definitiva");
  });
  it("não pega a orientação de dentista: retorno, escova, consulta, dor, peça e a negação da garantia", () => {
    for (const frase of [
      "Volte em 6 meses para a revisão",
      "Troque a escova em 3 meses",
      "Marque uma consulta de avaliação",
      "Em uma consulta de avaliação a dentista vê o seu caso",
      "Mesmo sem dor, vá ao dentista",
      "O dente definitivo entra depois do provisório",
      "A prótese definitiva é feita em laboratório",
      "Nenhum dentista garante resultado igual para todo mundo",
    ]) {
      expect(promessaEmSaude(frase), frase).toBeNull();
    }
  });
  it("não pega texto comum de saúde (avaliação, cuidado, passos, curativo)", () => {
    expect(promessaEmSaude("Na consulta, a dentista avalia se a limpeza resolve antes de falar em clarear.")).toBeNull();
    expect(promessaEmSaude("Escove por 2 minutos, duas vezes por dia")).toBeNull();
    expect(promessaEmSaude("Passe o curativo e espere")).toBeNull();
    expect(promessaEmSaude("O resultado varia de pessoa para pessoa.")).toBeNull();
  });
  it("a geração de saúde reprova o slide que promete; fora da saúde a mesma frase passa", () => {
    const slide = s("item", { texto: "Volta ao branco em uma sessão" });
    expect(verificarLimitesDosSlides([slide], { ramoSaude: true }).join()).toMatch(/não pode prometer resultado, cura, garantia nem prazo; tire "Volta ao branco"/);
    expect(verificarLimitesDosSlides([slide], { ramoSaude: false })).toEqual([]);
  });
});

describe("slidesDaSaida: o responsável técnico", () => {
  const vazio = { rotulo: "", titulo: "", texto: "", antes: "", depois: "", valor: "", unidade: "", fonte: "", referencia: "", quem: "", contexto: "", linhas: [] as string[], acoes: [] as string[] };
  const chamada: SlideDaSaida = { ...vazio, tipo: "chamada", titulo: "Salve", texto: "Mande", acoes: ["Salve", "Mande"] };
  it("entra só na chamada, em ramo de saúde, quando preenchido", () => {
    expect(slidesDaSaida([chamada], { ramoSaude: true, responsavelTecnico: "Dra. Ana, CRO-SP 1" })[0].responsavel).toBe("Dra. Ana, CRO-SP 1");
  });
  it("vazio, ausente ou fora da saúde, não entra", () => {
    expect(slidesDaSaida([chamada], { ramoSaude: true, responsavelTecnico: "" })[0].responsavel).toBeUndefined();
    expect(slidesDaSaida([chamada], { ramoSaude: true })[0].responsavel).toBeUndefined();
    expect(slidesDaSaida([chamada], { ramoSaude: false, responsavelTecnico: "Dra. Ana, CRO-SP 1" })[0].responsavel).toBeUndefined();
  });
});
