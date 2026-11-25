import { describe, expect, it } from "vitest";

import { FAMILIAS_DE_FORMULA, acharFormulasDeMaquina, acharFrasesPicotadas, acharNumeroAbreviado, avisosDeFormaDaFala, type FamiliaDeFormula, type TextoParaConferir } from "./formulas-de-maquina";

function familias(texto: TextoParaConferir, fontes?: string): FamiliaDeFormula[] {
  return acharFormulasDeMaquina(texto, { fontes }).map((a) => a.familia);
}

describe("formulas-de-maquina: o que PEGA", () => {
  const pega: [FamiliaDeFormula, TextoParaConferir][] = [
    ["contraste-negado", { gancho: "Não é sorte, é método." }],
    ["contraste-negado", { corpo: "Isso não é um gasto. É um investimento." }],
    ["contraste-negado", { gancho: "O problema não foi o preço, foi o atendimento" }],
    ["virada-de-efeito", { corpo: "Troquei a peça. E isso muda tudo." }],
    ["virada-de-efeito", { gancho: "Mas calma, tem mais" }],
    ["virada-de-efeito", { corpo: "O segredo é a massa descansar." }],
    ["abertura-de-preparacao", { gancho: "Hoje eu vou te falar de clareamento." }],
    ["abertura-de-preparacao", { gancho: "Neste vídeo você vai ver como lavar o sofá" }],
    ["despedida-cordial", { fechamento: "Espero que tenha gostado." }],
    ["despedida-cordial", { chamada: "Qualquer dúvida, me chama." }],
    ["despedida-cordial", { chamada: "Até o próximo vídeo!" }],
    ["intensificador-vazio", { corpo: "É um produto poderoso e transformador." }],
    ["intensificador-vazio", { titulo: "Um resultado incrível para o seu sofá" }],
    ["cada-vez-mais", { corpo: "Cada vez mais gente lava o sofá em casa." }],
    ["cada-vez-mais", { gancho: "Nos dias de hoje todo mundo tem pressa" }],
    ["paralelismo-de-slogan", { corpo: "Menos tempo, mais resultado." }],
    ["paralelismo-de-slogan", { corpo: "Sem dor, sem agulha, sem demora." }],
    ["revelacao-vazia", { gancho: "Descubra o jeito certo de lavar o sofá" }],
    ["revelacao-vazia", { titulo: "O que ninguém te conta sobre clareamento" }],
  ];
  it.each(pega)("%s: %j", (familia, texto) => {
    expect(familias(texto)).toContain(familia);
  });

  it("cobre as oito famílias da lista fechada", () => {
    expect(new Set(pega.map(([f]) => f))).toEqual(new Set(FAMILIAS_DE_FORMULA.map((f) => f.id)));
  });

  it("o achado traz motivo sem travessão, com a regra e o nome do bloco", () => {
    const [a] = acharFormulasDeMaquina({ gancho: "Não é sorte, é método." });
    expect(a.motivo).toContain("R-COPY-26");
    expect(a.motivo).toContain("o gancho");
    expect(a.motivo).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("formulas-de-maquina: o que NÃO pode pegar", () => {
  const naoPega: [string, TextoParaConferir, string?][] = [
    ["contraste cujas duas metades estão na ficha", { gancho: "Não é cárie, é erosão." }, "O dentista explica que mancha no dente pode ser cárie ou erosão do esmalte."],
    ["contraste com número (é conta, não molde)", { gancho: "Não são 30 dias, são 45." }],
    ["frase negativa sem a segunda metade", { corpo: "Não é caro porque o produto rende muito mais." }],
    ["a palavra 'segredo' em outro uso", { corpo: "O segredo da massa da vovó ficou na receita." }],
    ["'neste' de outro sentido", { corpo: "Neste sofá a mancha era de café." }],
    ["canal concreto na chamada", { chamada: "Qualquer dúvida, me chama no WhatsApp." }],
    ["intensificador com número na frase", { corpo: "Um resultado impressionante: 30% menos mancha." }],
    ["'cada vez mais' com dado", { corpo: "A procura cresceu: cada vez mais caro, subiu 12% em um ano." }],
    ["comparação com quanto", { corpo: "Quanto mais cedo, mais barato sai o conserto." }],
    ["slogan com número", { corpo: "Menos 3 dias, mais resultado." }],
    ["gancho direto e específico", { gancho: "O sofá da cliente de ontem tinha mancha de vinho de 3 dias." }],
    ["despedida com ação concreta", { chamada: "Manda a foto do sofá no direct e eu te passo o valor." }],
    ["intensificador fora da lista", { corpo: "A mancha saiu em dez minutos." }],
  ];
  it.each(naoPega)("%s", (_nome, texto, fontes) => {
    expect(familias(texto, fontes)).toEqual([]);
  });

  it("a mesma frase pega quando a ficha não traz as duas metades (a fonte é o que salva)", () => {
    expect(familias({ gancho: "Não é cárie, é erosão." }, "Clínica no bairro Vila Sorriso.")).toContain("contraste-negado");
  });

  it("família de abertura só olha gancho, título e tema; despedida só fechamento e chamada", () => {
    expect(familias({ corpo: "Hoje eu vou te falar de clareamento." })).toEqual([]);
    expect(familias({ gancho: "Espero que tenha gostado." })).toEqual([]);
  });

  it("bloco vazio ou ausente não quebra", () => {
    expect(acharFormulasDeMaquina({ gancho: "", corpo: "   " })).toEqual([]);
  });
});

describe("avisos de forma da fala", () => {
  it("três frases de até quatro palavras em fila avisam; duas ou uma frase média não", () => {
    expect(acharFrasesPicotadas("Pare. Olhe isso. Muda tudo. Agora.")).not.toBeNull();
    expect(acharFrasesPicotadas("Pare. Olhe isso. Depois eu explico com calma o que aconteceu.")).toBeNull();
    expect(avisosDeFormaDaFala({ corpo: "Lavou. Secou. Pronto." }).join(" ")).toContain("R-COPY-28");
  });

  it("número abreviado avisa: 10x, 10+, 3-5 dias, 10k, 1,5 mi; data e telefone não", () => {
    for (const t of ["rende 10x mais", "mais de 10+ clientes", "de 3-5 dias", "são 10k seguidores", "1,5 mi de views"]) expect(acharNumeroAbreviado(t), t).not.toBeNull();
    for (const t of ["dez vezes mais", "em 2026-11-25 abrimos", "ligue 11 98765-4321", "são 10 mil seguidores"]) {
      expect(acharNumeroAbreviado(t), t).toBeNull();
    }
    expect(avisosDeFormaDaFala({ gancho: "Rende 10x mais" }).join(" ")).toContain("R-COPY-29");
  });
});
