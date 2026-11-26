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
    // Onda 2 (25/11/2026): o roteiro real que o Gustavo achou genérico.
    ["contraste-negado", { fechamento: "O trailer não é o filme inteiro, é o pedaço que prova que vale assistir." }],
    ["muleta-de-abertura", { corpo: "Cara, é o seguinte: o trailer mostra uma cena e para." }],
    ["muleta-de-abertura", { corpo: "Olha só: o anúncio que andou foi outro." }],
    ["muleta-de-abertura", { corpo: "Então, olha, a loja vendia pouco." }],
    ["muleta-de-abertura", { fechamento: "Seguinte: chama no direct." }],
    ["fecho-de-confirmacao", { fechamento: "Tem que fazer sentido, sabe? O trailer prova que vale assistir." }],
    ["fecho-de-confirmacao", { chamada: "Chama no direct, né?" }],
    ["fecho-de-confirmacao", { fechamento: "É isso que muda a venda. Faz sentido?" }],
    ["fecho-de-confirmacao", { chamada: "Manda o oi no zap, entendeu?" }],
  ];
  it.each(pega)("%s: %j", (familia, texto) => {
    expect(familias(texto)).toContain(familia);
  });

  it("cobre as dez famílias da lista fechada", () => {
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
    // Falsos positivos achados pela Central em 25/11 (revisão do PR #267): texto normal de dono de negócio.
    ["conjunção 'e' não é o verbo 'é' (1)", { corpo: "O produto não é caro, e dá para parcelar em três vezes sem juros no cartão." }],
    ["conjunção 'e' não é o verbo 'é' (2)", { corpo: "Não é difícil, e você faz em casa com o que já tem." }],
    ["'antes de começar' com objeto, no gancho", { gancho: "Antes de começar a reforma do banheiro, confira o registro." }],
    ["'antes de começar' com objeto, no título", { titulo: "O que perguntar antes de começar o clareamento" }],
    ["'até a próxima' com prazo", { chamada: "A promoção vale até a próxima sexta, me chama no WhatsApp." }],
    ["'até o próximo' com substantivo", { fechamento: "Não espere até o próximo vazamento para trocar a borracha." }],
    ["'beijo' no meio de uma frase", { fechamento: "Ninguém quer mau hálito na hora do beijo." }],
    ["'número de likes' não é pedir like", { fechamento: "O que traz cliente é a prova, e não o número de likes." }],
    ["'mais A, mais B' descreve o produto", { corpo: "Esse pano é mais grosso, mais fácil de torcer e seca rápido." }],
    ["'sem A, sem B e sem C' com o fato nas fontes", { corpo: "A fórmula é sem cloro, sem álcool e sem perfume." }, "produto sem cloro, sem alcool e sem perfume"],
    // Segunda rodada (revisor independente, 25/11)
    ["contraste com as duas palavras de 4 letras nas fontes", { corpo: "Não é óleo, é água." }, "o oleo e a agua do sistema"],
    ["'transformador' é peça", { corpo: "O transformador do aparelho queimou." }],
    ["'bora' sem 'lá'", { gancho: "Bora lavar esse carro?" }],
    ["'nesse vídeo' no meio da frase", { gancho: "Esse barulho aparece nesse vídeo quando eu piso no freio." }],
    ["'se inscreva' com o link", { chamada: "Se inscreva na nossa oficina gratuita de troca de pneus pelo link." }],
    ["'à disposição' com o WhatsApp", { chamada: "Estamos à disposição no WhatsApp para passar o orçamento." }],
    ["'cada vez mais' fato do carro", { corpo: "O pedal está ficando cada vez mais duro." }],
    ["'menos A, mais B' no meio da frase", { corpo: "Se usar menos sabão, mais fácil fica enxaguar." }],
    ["'conheça' apresenta alguém", { gancho: "Conheça a Ana, nossa nova recepcionista." }],
    ["'você sabia que' com fato concreto", { gancho: "Você sabia que água sanitária mancha roupa colorida?" }],
    // Onda 2: a muleta só vale no começo do bloco, o reaviso do meio é pedido pela R-ROTEIRO-10.
    ["'olha o que muda agora' no meio do corpo", { corpo: "O cliente chegou com a loja parada. Olha só o que muda agora: a página passou a mostrar o produto em uso." }],
    ["'o seguinte' como adjetivo", { corpo: "O seguinte cliente chegou com a mesma dúvida, e a resposta foi a mesma." }],
    ["'seguinte' como parte da frase", { corpo: "No dia seguinte a loja vendeu três." }],
    ["'faz sentido' com objeto", { fechamento: "Faz sentido para o seu caso? Me chama no WhatsApp." }],
    ["'quem sabe?' no meio", { fechamento: "Quem sabe? Só testando." }],
    ["'sabe' como verbo", { fechamento: "Quem sabe quanto custa fala com o cliente primeiro." }],
    ["muleta fora de corpo e fecho, no gancho", { gancho: "Olha só o que a loja fez." }],
    ["pergunta de confirmação no corpo (só vale no fecho)", { corpo: "A venda subiu, sabe? Foi a foto." }],
    ["revelação com algarismo", { gancho: "Você sabia que 7 em cada 10 manchas de sofá vêm de bebida?" }],
  ];
  it.each(naoPega)("%s", (_nome, texto, fontes) => {
    expect(familias(texto, fontes)).toEqual([]);
  });

  it("a mesma frase pega quando a ficha não traz as duas metades (a fonte é o que salva)", () => {
    expect(familias({ gancho: "Não é cárie, é erosão." }, "Clínica no bairro Vila Sorriso.")).toContain("contraste-negado");
  });

  it("os 'pega' vizinhos dos ajustes continuam pegando", () => {
    expect(familias({ gancho: "Não é sobre preço, é sobre confiança." })).toContain("contraste-negado");
    expect(familias({ gancho: "Antes de começar, um aviso." })).toContain("abertura-de-preparacao");
    expect(familias({ gancho: "Antes de começar" })).toContain("abertura-de-preparacao");
    expect(familias({ fechamento: "Até a próxima!" })).toContain("despedida-cordial");
    expect(familias({ fechamento: "Até o próximo vídeo, pessoal." })).toContain("despedida-cordial");
    expect(familias({ fechamento: "Valeu, até o próximo post" })).toContain("despedida-cordial");
    expect(familias({ fechamento: "Um beijo." })).toContain("despedida-cordial");
    expect(familias({ fechamento: "Gostou? Abraço!" })).toContain("despedida-cordial");
    expect(familias({ fechamento: "Deixe seu like e compartilhe." })).toContain("despedida-cordial");
    expect(familias({ fechamento: "Dê um like." })).toContain("despedida-cordial");
    expect(familias({ corpo: "Mais tempo, menos custo." })).toContain("paralelismo-de-slogan");
    expect(familias({ corpo: "Sem cloro, sem álcool e sem perfume." }, "ficha da clínica")).toContain("paralelismo-de-slogan");
    expect(familias({ gancho: "Descubra o que o sofá guarda." })).toContain("revelacao-vazia");
    expect(familias({ corpo: "Não são 2 dias, são 3 dias. Não é sorte, é método." })).toContain("contraste-negado");
    expect(familias({ gancho: "Neste vídeo eu mostro." })).toContain("abertura-de-preparacao");
    expect(familias({ gancho: "Olha isso. Nesse vídeo eu mostro." })).toContain("abertura-de-preparacao");
    expect(familias({ corpo: "O motor é potente e transformador." })).toEqual([]);
    expect(familias({ corpo: "A mudança foi transformadora." })).toContain("intensificador-vazio");
    expect(familias({ gancho: "Bora lá, vamos lavar!" })).toContain("abertura-de-preparacao");
    expect(familias({ fechamento: "Estamos à disposição." })).toContain("despedida-cordial");
    expect(familias({ corpo: "Cada vez mais gente lava o sofá em casa." })).toContain("cada-vez-mais");
    expect(familias({ corpo: "O cliente acha que está cada vez mais importante." })).toContain("cada-vez-mais");
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
