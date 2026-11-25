import { describe, expect, it } from "vitest";

import type { SlideDoCarrossel } from "@/config/carrossel";

import { larguraDaImagem } from "./fotos";
import { avisosDoMetodo, capaTemPromessaConcreta, moldeVagoDaCapa, promessaDeContagem, rotularItens, verificarCapaVaga, verificarPromessaDaCapa } from "./metodo";

const capa = (titulo: string, sub?: string): SlideDoCarrossel => ({ tipo: "capa-texto", titulo, ...(sub ? { sub } : {}) });
const item = (texto = "Um texto de explicação com mais de oito palavras para ensinar"): SlideDoCarrossel => ({ tipo: "item", titulo: "Um item", texto });
const passo = (texto = "Um texto de explicação com mais de oito palavras para ensinar"): SlideDoCarrossel => ({ tipo: "passo", titulo: "Um passo", texto });
const chamada: SlideDoCarrossel = { tipo: "chamada", titulo: "Quer?", texto: "Salve", acoes: ["a", "b"] };

describe("promessaDeContagem", () => {
  it("lê o número da capa por algarismo ou por extenso, só quando conta uma lista", () => {
    expect(promessaDeContagem("3 erros que estragam o seu sofá")).toEqual({ quantidade: 3, coisa: "erros" });
    expect(promessaDeContagem("Cinco passos para escovar certo")).toEqual({ quantidade: 5, coisa: "passos" });
    expect(promessaDeContagem("Três dicas simples")).toEqual({ quantidade: 3, coisa: "dicas" });
    expect(promessaDeContagem("7 principais erros de quem limpa o box")).toEqual({ quantidade: 7, coisa: "erros" });
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
  it("a linha de apoio também vale, e capa sem promessa de número passa", () => {
    expect(verificarPromessaDaCapa([capa("Seu dente escureceu?", "4 causas possíveis"), item(), item(), chamada]).join()).toMatch(/promete 4 causas/);
    expect(verificarPromessaDaCapa([capa("Seu dente escureceu?"), item(), chamada])).toEqual([]);
  });
});

describe("capa vaga", () => {
  it("reprova os moldes banidos, com o nome do molde", () => {
    expect(moldeVagoDaCapa("Tudo o que você precisa saber sobre clareamento")).toBe("promete tudo sobre o assunto");
    expect(moldeVagoDaCapa("O guia definitivo da limpeza do box")).toBe("promete tudo sobre o assunto");
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
    expect(r.filter((s) => s.tipo === "item").map((s) => s.rotulo)).toEqual(["Erro 1 de 3", "Sinal 2 de 3", "Dica 3 de 3"]);
    expect(r.find((s) => s.tipo === "passo")!.rotulo).toBeUndefined();
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
