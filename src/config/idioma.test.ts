import { describe, expect, it } from "vitest";

import { detectarIdioma } from "./idioma";

describe("detectarIdioma, portugues", () => {
  const titulos = [
    "você não vai acreditar no que aconteceu com esse produto",
    "como isso mudou minha rotina de limpeza",
    "5 dicas que ninguém te conta sobre organização",
    "gancho perfeito para viralizar seu vídeo",
    "não esqueça de fazer isso antes de gravar",
    "aqui você vai aprender, e eu não menti",
    "o produto que está bombando no brasil inteiro",
    "isso vai transformar sua limpeza para sempre",
    "então eu decidi testar esse produto",
    "olha só o que aconteceu depois",
    "já pensou em fazer isso em casa",
    "com certeza você vai amar esse resultado",
    "porque ninguém fala sobre isso",
    "mostra como usar o produto certo",
    "até hoje eu não sabia disso",
    "essa dica vai facilitar sua vida",
    "video tutorial de organização da casa",
    "pra você que ama produtos de limpeza",
    "né, isso realmente funciona",
    "pergunta que ninguém faz sobre esse assunto",
  ];

  it.each(titulos)("detecta pt em: %s", (titulo) => {
    expect(detectarIdioma(titulo)).toBe("pt");
  });
});

/**
 * Revisão do Fable no PR #46: 600 vídeos fora da curva de produção, 23%
 * voltando nulo, quase todos português de título curto. Os oito exemplos
 * reais da medição.
 */
describe("detectarIdioma, portugues de titulo curto (revisao do PR #46, medicao em 600 videos reais)", () => {
  const titulos = [
    "Vem ARRUMAR o QUARTO COMIGO #shorts #donadecasa #vidareal",
    "Como limpar a porta de vidro a seco #faxina #porta #vidro",
    "Joguei sal nas manchas de ferrugem e me surpreendi...#dicas #limpeza #donadecasa",
    "Dia chuvoso por aqui #donadecasa #vidademae #casasimples",
    "Limpeza ASMR satisfatória #limpeza #viral",
    "cheguei no interior",
    "vizinho curioso #humor",
    "maleta de maquiagem",
  ];

  it.each(titulos)("detecta pt em: %s", (titulo) => {
    expect(detectarIdioma(titulo)).toBe("pt");
  });
});

describe("detectarIdioma, ingles", () => {
  const titulos = [
    "you won't believe what happened next",
    "the truth nobody tells you about this",
    "how this changed my cleaning routine",
    "5 tips nobody talks about it",
    "watch this before you clean your house",
    "why nobody told you this secret",
    "this is the perfect hook for your content",
    "never do this before recording",
    "here is the complete guide",
    "just wait until you see this",
    "guys check this out now",
    "what really happened with this product",
    "when you finally understand this trick",
    "the secret that will change your life",
    "how to clean your house like a pro",
  ];

  it.each(titulos)("detecta en em: %s", (titulo) => {
    expect(detectarIdioma(titulo)).toBe("en");
  });
});

describe("detectarIdioma, espanhol", () => {
  const titulos = [
    "no vas a creer lo que pasó, esto es una locura",
    "el secreto que nadie te cuenta sobre la limpieza",
    "mira cómo cambió mi rutina de limpieza",
    "esto es tan bueno que vas a amarlo",
    "gracias por ver este video hasta el final",
    "los mejores trucos que existen, según los expertos",
    "usted no va a creer esto",
    "años de experiencia en productos de limpieza",
    "según los expertos, esto es un error común",
    "ahora vas a entender por qué esto funciona",
    "hola, quiero mostrarte algo increíble",
    "así funciona el mejor producto de limpieza",
    "tú puedes hacerlo también en casa",
    "eso que nadie te dice sobre la limpieza",
    "muy pocas personas saben esto",
  ];

  it.each(titulos)("detecta es em: %s", (titulo) => {
    expect(detectarIdioma(titulo)).toBe("es");
  });
});

describe("detectarIdioma, alfabeto nao latino vira outro", () => {
  const titulos = [
    "如何在家清洁厨房", // chines
    "掃除のコツを教えます", // japones (hiragana e katakana)
    "청소하는 방법을 알려드릴게요", // coreano (hangul)
    "كيف تنظف منزلك بسرعة", // arabe
    "как быстро убрать квартиру", // russo (cirilico)
    "วิธีทำความสะอาดบ้าน", // tailandes
    "घर की सफाई कैसे करें", // hindi (devanagari)
    "5 tips para limpiar 清洁小窍门", // misturado com texto latino, ainda vira outro
  ];

  it.each(titulos)("detecta outro em: %s", (titulo) => {
    expect(detectarIdioma(titulo)).toBe("outro");
  });
});

describe("detectarIdioma, nunca chuta: null quando nao da para saber", () => {
  it("string vazia", () => {
    expect(detectarIdioma("")).toBeNull();
  });

  it("titulo so com hashtag, sem nenhum radical do dicionario de portugues nem palavra de sinal", () => {
    expect(detectarIdioma("#foryou #fyp #trending")).toBeNull();
  });

  it("texto curto demais (menos de tres palavras)", () => {
    expect(detectarIdioma("top 10")).toBeNull();
  });

  it("so numeros e ano, sem letra nenhuma", () => {
    expect(detectarIdioma("123456 2024")).toBeNull();
  });

  it("alfabeto latino sem nenhuma palavra de sinal nem acentuacao caracteristica", () => {
    expect(detectarIdioma("top produto revolucionário internacional")).toBeNull();
  });

  it("titulo misturado, com sinal empatado entre dois idiomas", () => {
    expect(detectarIdioma("check isso")).toBeNull();
  });
});

/**
 * Item (b) da revisão do PR #46: antes desta rodada, "#limpeza #dicas
 * #viral" devolvia null (o teste acima usava esse exemplo). Com o
 * dicionário de radicais de hashtag e "limpeza"/"dicas" agora na lista de
 * palavras, esse titulo passa a ter sinal de verdade: mudança intencional,
 * é exatamente o caso que a rodada corrige (exemplo 5 da medição).
 */
describe("detectarIdioma, hashtag com radical do dicionario vira sinal de portugues (revisao do PR #46)", () => {
  it("titulo so com hashtags de radical portugues: detecta pt", () => {
    expect(detectarIdioma("#limpeza #dicas #viral")).toBe("pt");
  });
});

/** Item (c) da revisão do PR #46: com exatamente 2 palavras, ambas do portugues, o minimo cai de 3 para 2. */
describe("detectarIdioma, minimo de palavras cai para 2 quando ambas sao do portugues (revisao do PR #46)", () => {
  it("duas palavras, ambas da lista do portugues: detecta pt", () => {
    expect(detectarIdioma("faxina hoje")).toBe("pt");
  });

  it("duas palavras, so uma da lista do portugues: continua null (minimo de 3 nao cai)", () => {
    expect(detectarIdioma("faxina bonita")).toBeNull();
  });

  it("uma palavra so: continua null, mesmo sendo da lista do portugues", () => {
    expect(detectarIdioma("faxina")).toBeNull();
  });
});
