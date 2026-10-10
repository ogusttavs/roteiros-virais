import { describe, expect, it } from "vitest";

import {
  ambienteComBarulho,
  BLOCOS_FALADOS,
  conferirFala,
  consertarMarcas,
  contarPalavras,
  escreverPalavras,
  lerPalavras,
  marcadoParaOsParagrafos,
  marcasBemFormadas,
  MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS,
  MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS_MAIS_DEVAGAR,
  normalizar,
  paragrafosMarcados,
  pesoPelaMaisComprida,
  publicoMaisVelho,
  temChaveNoTexto,
  textoIdentico,
  textoSemMarcas,
  TOM_PADRAO_DO_BLOCO,
  TONS_DO_BLOCO,
  trechosDaFala,
} from "./marcas-de-fala";

/** O texto marcado depois da leitura e da escrita: a marca nunca pode mudar o que se diz. */
function idaEVolta(marcado: string): string {
  return escreverPalavras(lerPalavras(marcado));
}

function pausasEPalavras(marcado: string): number[] {
  // As distâncias, em palavras, entre uma pausa e a seguinte (a última, até o fim do texto).
  const palavras = lerPalavras(marcado);
  const distancias: number[] = [];
  let desde = 0;
  for (const p of palavras) {
    desde += 1;
    if (p.pausa) {
      distancias.push(desde);
      desde = 0;
    }
  }
  if (desde > 0) distancias.push(desde);
  return distancias;
}

describe("a trava: o texto sem as marcas é o original", () => {
  const original = "O carro chegou com uma mancha no banco. Eu tirei em dois minutos, sem esforço!";

  it("aceita o mesmo texto com marcas de todo tipo", () => {
    const marcado = "O carro chegou com uma {p:mancha} no banco.{v}{//} Eu tirei em {d:dois minutos},{/} sem {p:esforço}!{//}";
    expect(textoIdentico(original, marcado)).toBe(true);
    expect(textoSemMarcas(marcado)).toBe(original);
  });

  it("aceita o texto sem marca nenhuma e com espaço ou quebra de linha a mais", () => {
    expect(textoIdentico(original, original)).toBe(true);
    expect(textoIdentico(original, "  O carro chegou com uma mancha no banco.\n\nEu tirei em dois minutos,  sem esforço! ")).toBe(true);
  });

  it("reprova uma palavra trocada, uma a mais, uma a menos e a ordem trocada", () => {
    expect(textoIdentico(original, "O carro chegou com uma {p:nódoa} no banco. Eu tirei em dois minutos, sem esforço!")).toBe(false);
    expect(textoIdentico(original, "O carro chegou com uma mancha feia no banco. Eu tirei em dois minutos, sem esforço!")).toBe(false);
    expect(textoIdentico(original, "O carro chegou com uma mancha no banco. Eu tirei em dois minutos, sem!")).toBe(false);
    expect(textoIdentico(original, "Eu tirei em dois minutos, sem esforço! O carro chegou com uma mancha no banco.")).toBe(false);
  });

  it("reprova pontuação ou acento mudados, mesmo que a palavra seja a mesma", () => {
    expect(textoIdentico(original, "O carro chegou com uma {p:mancha} no banco. Eu tirei em dois minutos sem esforço!")).toBe(false);
    expect(textoIdentico(original, "O carro chegou com uma mancha no banco. Eu tirei em dois minutos, sem esforco!")).toBe(false);
    expect(textoIdentico(original, "O carro chegou com uma mancha no banco, eu tirei em dois minutos, sem esforço!")).toBe(false);
  });

  it("reprova uma marca mal fechada, desconhecida ou com chave solta", () => {
    expect(textoIdentico("a casa", "a {p:casa")).toBe(false);
    expect(textoIdentico("a casa", "a {x}casa")).toBe(false);
    expect(textoIdentico("a casa", "a {p:casa}}")).toBe(false);
    expect(marcasBemFormadas("a {p:casa}{//}")).toBe(true);
    expect(marcasBemFormadas("a {p:casa")).toBe(false);
  });

  it("a chave solta no próprio texto não passa, mesmo quando o texto marcado é igual ao original", () => {
    // Sem a conferência da sintaxe, "a {p:casa" (sem fechar) seria igual a ele mesmo.
    expect(textoIdentico("a {p:casa", "a {p:casa")).toBe(false);
    expect(textoIdentico("a {x}casa", "a {x}casa")).toBe(false);
  });

  it("maiúscula e minúscula são textos diferentes", () => {
    expect(textoIdentico("A mancha voltou", "a mancha voltou")).toBe(false);
    expect(textoIdentico("A mancha voltou", "A {p:mancha} voltou")).toBe(true);
  });

  it("o texto de um roteiro com chave não é marcado", () => {
    expect(temChaveNoTexto("preço {p:alto}")).toBe(true);
    expect(temChaveNoTexto("preço alto")).toBe(false);
  });

  it("a marca colada na pontuação, nas aspas e no hífen não muda o texto", () => {
    const casos = [
      'Ela disse "{p:mancha}" e saiu.',
      "Olhe ({p:isto}), por favor.",
      "O {p:guarda}-{p:chuva} voltou.",
      "Foi {p:muito}{p:bom}.",
      "Veja{/} bem, {d:R$ 297}{//} por mês.",
      "re{p:novar}",
    ];
    for (const marcado of casos) {
      expect(textoSemMarcas(idaEVolta(marcado))).toBe(textoSemMarcas(marcado));
      expect(textoIdentico(textoSemMarcas(marcado), marcado)).toBe(true);
    }
  });
});

describe("lerPalavras e escreverPalavras", () => {
  it("lê o peso, o devagar, a pausa e o tom nas palavras", () => {
    const palavras = lerPalavras("Isso {p:custa} {d:R$ 297 por mês}.{v}{//} Quer?{^}{/}");
    expect(palavras.map((p) => p.texto)).toEqual(["Isso", "custa", "R$", "297", "por", "mês.", "Quer?"]);
    expect(palavras[1].peso).toBe(true);
    expect(palavras.slice(2, 6).every((p) => p.devagar)).toBe(true);
    expect(palavras[5]).toMatchObject({ tom: "desce", pausa: "longa" });
    expect(palavras[6]).toMatchObject({ tom: "sobe", pausa: "curta" });
  });

  it("a pontuação colada na marca fica fora dela na escrita", () => {
    expect(idaEVolta("Veja a {p:mancha}, e o resto.")).toBe("Veja a {p:mancha}, e o resto.");
    expect(idaEVolta('Ele disse "{p:nunca}" e foi.')).toBe('Ele disse "{p:nunca}" e foi.');
    expect(idaEVolta("Custa {d:R$ 297 por mês}.{//}")).toBe("Custa {d:R$ 297 por mês}.{//}");
  });

  it("palavras coladas viram uma só e uma marca antes de qualquer palavra é ignorada", () => {
    expect(lerPalavras("{//}{p:Oi} tudo bem").map((p) => p.texto)).toEqual(["Oi", "tudo", "bem"]);
    expect(lerPalavras("guarda{p:-chuva}").map((p) => p.texto)).toEqual(["guarda-chuva"]);
  });

  it("um peso dentro de um trecho devagar não aparece: o trecho inteiro já é o destaque", () => {
    expect(idaEVolta("Custa {d:R$ 297} {p:hoje}.")).toBe("Custa {d:R$ 297} {p:hoje}.");
    const p = lerPalavras("{d:R$ 297}");
    p[1].peso = true;
    expect(escreverPalavras(p)).toBe("{d:R$ 297}");
  });

  it("o devagar fecha no tom ou na pausa e abre outro depois", () => {
    const palavras = lerPalavras("{d:um dois três quatro}");
    palavras[1].pausa = "curta";
    expect(escreverPalavras(palavras)).toBe("{d:um dois}{/} {d:três quatro}");
  });

  it("normaliza espaço", () => {
    expect(normalizar("  a \n  b\t c ")).toBe("a b c");
    expect(contarPalavras("  uma  frase\ncom cinco palavras ")).toBe(5);
    expect(contarPalavras("   ")).toBe(0);
  });
});

describe("consertarMarcas: o que as regras que conferem por código põem e tiram", () => {
  it("R-FALA-03: toda frase termina em pausa longa; a curta que o modelo pôs no fim da frase vira longa", () => {
    const { texto } = consertarMarcas("Chegou cedo. Saiu tarde!{/} E voltou?{//}");
    expect(texto).toBe("Chegou cedo.{//} Saiu tarde!{//} E voltou?{//}");
  });

  it("R-FALA-03: a frase de 13 palavras com a pausa longa na 13ª também passa do limite de 12 (e de 9 com barulho)", () => {
    const treze = Array.from({ length: 13 }, (_, i) => `p${i + 1}`).join(" ") + ".";
    const normal = consertarMarcas(treze).texto;
    expect(normal).toContain("{/}");
    for (const d of pausasEPalavras(normal)) expect(d).toBeLessThanOrEqual(MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS);
    // 12 palavras cabem sem pausa curta
    expect(consertarMarcas(Array.from({ length: 12 }, (_, i) => `p${i + 1}`).join(" ") + ".").texto).not.toContain("{/}");
    // 10 palavras passam do limite de 9
    const dez = Array.from({ length: 10 }, (_, i) => `p${i + 1}`).join(" ") + ".";
    expect(consertarMarcas(dez).texto).not.toContain("{/}");
    const devagar = consertarMarcas(dez, { maisDevagar: true }).texto;
    expect(devagar).toContain("{/}");
    for (const d of pausasEPalavras(devagar)) expect(d).toBeLessThanOrEqual(MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS_MAIS_DEVAGAR);
  });

  it("R-FALA-03: o número de lista, a rua e a abreviatura não terminam a frase; o 'etc.' termina", () => {
    expect(consertarMarcas("1. Tire o excesso.").texto).toBe("{d:1}. Tire o excesso.{//}");
    expect(consertarMarcas("Venha na R. Augusta hoje.").texto).toBe("Venha na R. Augusta hoje.{//}");
    expect(consertarMarcas("Tel. 3333 agora.").texto).toBe("Tel. {d:3333} agora.{//}");
    expect(consertarMarcas("Tem pano, balde, etc. Venha conhecer.").texto).toBe("Tem pano, balde, etc.{//} Venha conhecer.{//}");
    // um número no fim da frase continua terminando a frase
    expect(consertarMarcas("Custa 30. Venha.").texto).toBe("Custa {d:30}.{//} Venha.{//}");
  });

  it("R-FALA-03: sem vírgula nem conjunção, a pausa não cai depois do artigo nem da preposição", () => {
    // 14 palavras, a 7ª é "o": o meio cairia depois dela, e a pausa recua para depois de "seis".
    const original = "um dois três quatro cinco seis o carro novo chegou ontem na loja hoje.";
    const { texto } = consertarMarcas(original);
    expect(texto).toContain("seis{/}");
    expect(texto).not.toContain("o{/}");
    expect(textoIdentico(original, texto)).toBe(true);
  });

  it("R-FALA-03: a pausa curta não parte 'tudo o que eu fiz' nem 'a verdade é que'", () => {
    const original = "Eu quero que você saiba tudo o que eu fiz para resolver aquilo que ninguém queria resolver nesta casa.";
    const { texto } = consertarMarcas(original);
    expect(texto).not.toMatch(/\bo\{\/\} que\b/);
    expect(texto).not.toMatch(/\{\/\} que\b/);
    expect(textoIdentico(original, texto)).toBe(true);
  });

  it("R-FALA-03: um trecho comprido sem pausa ganha uma pausa curta onde a frase já respira", () => {
    const original = "Eu cheguei na loja de manhã bem cedo, abri a porta, e aí o cliente entrou com uma pergunta que eu nunca tinha ouvido antes disso.";
    const { texto, correcoes } = consertarMarcas(original);
    expect(textoIdentico(original, texto)).toBe(true);
    expect(correcoes.some((c) => c.startsWith("R-FALA-03: pausa curta"))).toBe(true);
    // a pausa curta caiu na vírgula, não no meio de uma ideia
    expect(texto).toContain("cedo,{/}");
    for (const d of pausasEPalavras(texto)) expect(d).toBeLessThanOrEqual(MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS);
  });

  it("R-FALA-03: sem vírgula nem conjunção, a pausa vai no meio do trecho", () => {
    const original = "um dois três quatro cinco seis sete oito nove dez onze doze treze quatorze quinze dezesseis.";
    const { texto } = consertarMarcas(original);
    expect(textoIdentico(original, texto)).toBe(true);
    const distancias = pausasEPalavras(texto);
    expect(distancias.length).toBeGreaterThanOrEqual(2);
    for (const d of distancias) expect(d).toBeLessThanOrEqual(MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS);
  });

  it("R-FALA-14 e 15: com ambiente de barulho ou público mais velho, o trecho máximo cai para nove palavras", () => {
    const original = Array.from({ length: 30 }, (_, i) => `n${i + 1}`).join(" ") + ".";
    const normal = pausasEPalavras(consertarMarcas(original).texto);
    const devagar = pausasEPalavras(consertarMarcas(original, { maisDevagar: true }).texto);
    expect(Math.max(...normal)).toBeLessThanOrEqual(MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS);
    expect(Math.max(...devagar)).toBeLessThanOrEqual(MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS_MAIS_DEVAGAR);
    expect(devagar.length).toBeGreaterThan(normal.length);
  });

  it("R-FALA-05: no máximo um peso por frase curta, dois por frase comprida, nunca dois seguidos", () => {
    const curta = consertarMarcas("A {p:mancha} {p:antiga} saiu {p:rápido}.").texto;
    expect(lerPalavras(curta).filter((p) => p.peso)).toHaveLength(1);
    expect(curta).toContain("{p:mancha}");
    const longa = consertarMarcas("Quando a {p:mancha} chegou na clínica eu pensei que seria impossível tirar, mas o {p:produto} {p:certo} resolveu tudo de uma vez só.").texto;
    const pesos = lerPalavras(longa).filter((p) => p.peso);
    expect(pesos).toHaveLength(2);
    expect(pesos.map((p) => p.texto)).toEqual(["mancha", "produto"]);
  });

  it("R-FALA-05: duas palavras de peso coladas numa frase comprida ficam com a primeira", () => {
    // 13 palavras: cabem dois pesos, mas nunca colados.
    const { texto } = consertarMarcas("Quando a {p:mancha} {p:antiga} chegou na clínica eu pensei que seria impossível tirar.");
    expect(lerPalavras(texto).filter((p) => p.peso).map((p) => p.texto)).toEqual(["mancha"]);
  });

  it("R-FALA-09: o tom só sobe em pergunta de verdade, no fim dela", () => {
    const { texto } = consertarMarcas("Isso funciona?{^} Funciona sim.{^} Quer ver{^} agora?");
    expect(texto).toBe("Isso funciona?{^}{//} Funciona sim.{//} Quer ver agora?{//}");
    // a pergunta no meio do texto continua com o tom que sobe só no último
    expect(consertarMarcas("Quer ver{^} agora?{^}").texto).toBe("Quer ver agora?{^}{//}");
    // "?!" é pergunta
    expect(consertarMarcas("Sério?!{^}").texto).toBe("Sério?!{^}{//}");
  });

  it("R-FALA-08: número e preço ficam devagar com a unidade, sem peso", () => {
    const { texto, correcoes } = consertarMarcas("Isso custa R$ 297 por mês, e dura 30 dias com {p:garantia}.");
    expect(texto).toContain("{d:R$ 297 por mês},");
    expect(texto).toContain("{d:30 dias}");
    expect(texto).toContain("{p:garantia}");
    expect(correcoes.filter((c) => c.startsWith("R-FALA-08"))).toHaveLength(3);
  });

  it("R-FALA-08: o peso que o modelo pôs num número vira devagar", () => {
    const { texto } = consertarMarcas("São {p:297} reais.");
    expect(texto).toBe("São {d:297 reais}.{//}");
  });

  it("R-FALA-08 e 09: a chamada final é dita devagar e termina com o tom descendo", () => {
    const { texto } = consertarMarcas("Chame no WhatsApp agora.", { chamadaFinal: true });
    expect(texto).toBe("{d:Chame no WhatsApp agora}.{v}{//}");
    // a chamada final é sempre afirmação (R-FALA-09): mesmo escrita como pergunta, ou com o tom que sobe, termina descendo
    expect(consertarMarcas("Vamos conversar?", { chamadaFinal: true }).texto).toBe("{d:Vamos conversar}?{v}{//}");
    expect(consertarMarcas("Chame agora.{^}", { chamadaFinal: true }).texto).toBe("{d:Chame agora}.{v}{//}");
    // um fecho curto depois do pedido não leva o devagar sozinho: o pedido também
    expect(consertarMarcas("Chame no WhatsApp agora. Obrigado!", { chamadaFinal: true }).texto).toBe("{d:Chame no WhatsApp agora}.{//} {d:Obrigado}!{v}{//}");
    // quem já disse devagar no fim não é refeito
    const feito = consertarMarcas("Chame no {d:WhatsApp} agora.", { chamadaFinal: true }).texto;
    expect(feito).toBe("Chame no {d:WhatsApp} agora.{v}{//}");
  });

  it("nunca muda o texto e não acrescenta nada a um texto já consertado", () => {
    const original = "Quando a mancha apareceu eu achei que era o fim. Mas custa R$ 49 por mês, e resolve em 2 minutos! Quer ver como? Chame agora.";
    const primeira = consertarMarcas(original, { chamadaFinal: true });
    expect(textoIdentico(original, primeira.texto)).toBe(true);
    const segunda = consertarMarcas(primeira.texto, { chamadaFinal: true });
    expect(segunda.texto).toBe(primeira.texto);
    expect(segunda.correcoes).toEqual([]);
  });

  it("texto vazio devolve vazio", () => {
    expect(consertarMarcas("   ")).toEqual({ texto: "", correcoes: [] });
  });

  it("a abreviatura com ponto não termina a frase", () => {
    const { texto } = consertarMarcas("A Dra. Ana atende hoje.");
    expect(texto).toBe("A Dra. Ana atende hoje.{//}");
  });
});

describe("a trava com texto sorteado: marcar e consertar nunca muda o texto", () => {
  const VOCABULARIO = ["a", "o", "mancha", "carro", "R$", "297", "por", "mês,", "banco.", "clínica?", "agora!", "30%", "dias", "(veja)", '"nunca"', "guarda-chuva", "Dra.", "etc.", "…", "saiu,", "e", "mas"];
  function sorteio(semente: number): () => number {
    let s = semente;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it("para 300 textos e marcações aleatórias o texto sem marcas é sempre o original", () => {
    for (let n = 1; n <= 300; n += 1) {
      const aleatorio = sorteio(n);
      const tamanho = 1 + Math.floor(aleatorio() * 40);
      const palavras: string[] = [];
      for (let i = 0; i < tamanho; i += 1) palavras.push(VOCABULARIO[Math.floor(aleatorio() * VOCABULARIO.length)]);
      const original = palavras.join(" ");
      const marcado = palavras
        .map((p) => {
          const sorte = aleatorio();
          if (sorte < 0.15) return `{p:${p}}`;
          if (sorte < 0.25) return `{d:${p}}{/}`;
          if (sorte < 0.32) return `${p}{//}`;
          if (sorte < 0.37) return `${p}{^}`;
          if (sorte < 0.42) return `${p}{v}`;
          return p;
        })
        .join(" ");
      expect(textoIdentico(original, marcado)).toBe(true);
      const consertado = consertarMarcas(marcado, { chamadaFinal: n % 2 === 0, maisDevagar: n % 3 === 0 });
      expect(textoIdentico(original, consertado.texto), `caso ${n}: ${original}`).toBe(true);
      expect(textoIdentico(original, idaEVolta(marcado))).toBe(true);
    }
  });
});

describe("conferirFala: o que vira texto de apoio, nunca marca", () => {
  it("R-FALA-01: a primeira palavra do vídeo é uma muleta", () => {
    expect(conferirFala({ gancho: "Então, hoje eu vou mostrar uma coisa.", corpo: "x." })).toEqual([{ regra: "R-FALA-01", muleta: "Então" }]);
    expect(conferirFala({ gancho: "É isso que ninguém te conta.", corpo: "x." })).toEqual([{ regra: "R-FALA-01", muleta: "É" }]);
    expect(conferirFala({ gancho: "Ninguém te conta isso.", corpo: "x." })).toEqual([]);
    // "E" e "Assim" começam muita frase boa: só o "É" com acento é a muleta da regra
    expect(conferirFala({ gancho: "E se eu te contasse o que ninguém conta?", corpo: "x." })).toEqual([]);
    expect(conferirFala({ gancho: "Assim que cheguei, a mancha voltou.", corpo: "x." })).toEqual([]);
    expect(conferirFala({ gancho: "Olha isso aqui.", corpo: "x." })).toEqual([]);
    // a muleta no meio do vídeo não conta
    expect(conferirFala({ gancho: "Isso é um segredo.", corpo: "Então veja." })).toEqual([]);
  });

  it("R-FALA-04: uma frase de mais de 25 palavras não cabe num fôlego (20 com ambiente de barulho)", () => {
    const vinte = Array.from({ length: 22 }, (_, i) => `p${i}`).join(" ") + ".";
    const trinta = Array.from({ length: 30 }, (_, i) => `q${i}`).join(" ") + ".";
    expect(conferirFala({ gancho: "Oi.", corpo: vinte })).toEqual([]);
    expect(conferirFala({ gancho: "Oi.", corpo: trinta })).toEqual([{ regra: "R-FALA-04", comeco: "q0 q1 q2 q3 q4 q5", palavras: 30 }]);
    expect(conferirFala({ gancho: "Oi.", corpo: vinte }, { ambienteComBarulho: true }).map((c) => c.regra)).toEqual(["R-FALA-04", "R-FALA-14"]);
  });

  it("R-FALA-14 e 15 só aparecem quando o contexto pede", () => {
    expect(conferirFala({ gancho: "Oi." }, { ambienteComBarulho: true, publicoMaisVelho: true }).map((c) => c.regra)).toEqual(["R-FALA-14", "R-FALA-15"]);
    expect(conferirFala({ gancho: "Oi." })).toEqual([]);
  });

  it("acha o ambiente de barulho e o público mais velho no texto da marca", () => {
    expect(ambienteComBarulho(["Gravar na oficina, com as máquinas ligadas"])).toBe(true);
    expect(ambienteComBarulho(["Gravar em casa, na sala"])).toBe(false);
    expect(ambienteComBarulho(["Na avenida ao lado da loja"])).toBe(true);
    expect(ambienteComBarulho(["Na feira de domingo", "no canteiro de obra"])).toBe(true);
    // palavras que contêm a palavra, mas não são o lugar
    expect(ambienteComBarulho(["Toda segunda-feira eu mostro a mão de obra e a máquina de lavar"])).toBe(false);
    expect(publicoMaisVelho(["Clientes idosos que moram sozinhos"])).toBe(true);
    expect(publicoMaisVelho(["Homens de 60 a 75 anos"])).toBe(true);
    expect(publicoMaisVelho(["Mulheres de 30 a 45 anos"])).toBe(false);
    expect(publicoMaisVelho(["Pessoas com 65 anos ou mais"])).toBe(true);
    // 60 anos de mercado é da empresa, não do público
    expect(publicoMaisVelho(["Empresa com 60 anos de mercado, clientes de 30 a 45 anos"])).toBe(false);
  });
});

describe("trechosDaFala e paragrafosMarcados (a tela)", () => {
  it("cada marca vira um trecho, na ordem, e o texto dos trechos de texto, peso e devagar é o do roteiro", () => {
    const marcado = "Se volta,{/} o problema é a {p:ordem}.{v}{//} Custa {d:R$ 49}?{^}{//}";
    const trechos = trechosDaFala(marcado);
    expect(trechos.map((t) => t.tipo)).toEqual(["texto", "pausa", "texto", "peso", "texto", "tom", "pausa", "texto", "devagar", "texto", "tom", "pausa"]);
    expect(trechos[1]).toEqual({ tipo: "pausa", duracao: "curta" });
    expect(trechos[5]).toEqual({ tipo: "tom", direcao: "desce" });
    expect(trechos[6]).toEqual({ tipo: "pausa", duracao: "longa" });
    expect(trechos[10]).toEqual({ tipo: "tom", direcao: "sobe" });
    const lido = trechos
      .filter((t) => t.tipo === "texto" || t.tipo === "peso" || t.tipo === "devagar")
      .map((t) => (t as { texto: string }).texto)
      .join("");
    // Nenhum espaço sai nem entra: o que se lê é o texto do roteiro.
    expect(lido).toBe("Se volta, o problema é a ordem. Custa R$ 49?");
    expect(normalizar(lido)).toBe(textoSemMarcas(marcado));
  });

  it("texto sem marca é um trecho só, e vazio não tem trecho", () => {
    expect(trechosDaFala("Uma frase.")).toEqual([{ tipo: "texto", texto: "Uma frase." }]);
    expect(trechosDaFala("")).toEqual([]);
  });

  it("os parágrafos marcados de um bloco voltam por quebra de linha, sem os vazios", () => {
    const marcas = {
      blocos: [
        { bloco: "gancho" as const, marcado: "Oi.{//}", tom: "direto" as const },
        { bloco: "corpo" as const, marcado: "Um.{//}\nDois.{//}", tom: "perto" as const },
      ],
      avisos: [],
    };
    expect(paragrafosMarcados(marcas, "corpo")).toEqual(["Um.{//}", "Dois.{//}"]);
    expect(paragrafosMarcados(marcas, "gancho")).toEqual(["Oi.{//}"]);
    expect(paragrafosMarcados(marcas, "fechamento")).toBeNull();
    expect(paragrafosMarcados(null, "gancho")).toBeNull();
  });
});

describe("marcadoParaOsParagrafos: a trava, repetida na hora de desenhar", () => {
  it("devolve o marcado quando o texto e a quantidade de parágrafos batem", () => {
    const marcado = ["Um {p:dia}.{//}", "Dois.{//}"];
    expect(marcadoParaOsParagrafos(["Um dia.", "Dois."], marcado)).toEqual(marcado);
  });

  it("recusa marca de texto velho: o texto da tela é outro", () => {
    expect(marcadoParaOsParagrafos(["Outro dia.", "Dois."], ["Um {p:dia}.{//}", "Dois.{//}"])).toBeNull();
    expect(marcadoParaOsParagrafos(["Um dia.", "Dois."], null)).toBeNull();
    expect(marcadoParaOsParagrafos(["Um dia."], [])).toBeNull();
  });

  it("a tela mostra um parágrafo só e o servidor dividiu por quebra de linha: junta com espaço, como o HTML faria", () => {
    expect(marcadoParaOsParagrafos(["A mancha voltou. Ninguém conta."], ["A mancha voltou.{//}", "Ninguém conta.{//}"])).toEqual([
      "A mancha voltou.{//} Ninguém conta.{//}",
    ]);
  });

  it("a quantidade de parágrafos não bate e a tela mostra mais de um: recusa", () => {
    expect(marcadoParaOsParagrafos(["Um.", "Dois.", "Três."], ["Um.{//}", "Dois. Três.{//}"])).toBeNull();
  });
});

describe("o resto da biblioteca", () => {
  it("os quatro blocos têm os nomes do conteúdo do roteiro e cada um tem o seu tom padrão", () => {
    expect(BLOCOS_FALADOS).toEqual(["gancho", "corpo", "fechamento", "chamadaFinal"]);
    expect(Object.keys(TOM_PADRAO_DO_BLOCO)).toEqual([...BLOCOS_FALADOS]);
    expect(TONS_DO_BLOCO).toContain(TOM_PADRAO_DO_BLOCO.chamadaFinal);
  });

  it("o simulador põe peso na palavra mais comprida de cada frase e não muda o texto", () => {
    const original = "A mancha saiu. Foi rápido!";
    const marcado = pesoPelaMaisComprida(original);
    expect(marcado).toBe("A {p:mancha} saiu. Foi {p:rápido}!");
    expect(textoIdentico(original, marcado)).toBe(true);
    // O tom que sobe vai no fim da pergunta.
    expect(pesoPelaMaisComprida("Você já passou por isso?")).toBe("Você já {p:passou} por isso?{^}");
  });
});
