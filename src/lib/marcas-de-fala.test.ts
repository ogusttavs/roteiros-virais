import { describe, expect, it } from "vitest";

import {
  ambienteComBarulho,
  BLOCOS_FALADOS,
  conferirFala,
  consertarMarcas,
  contarPalavras,
  escreverPalavras,
  IDS_DAS_REGRAS_DE_FALA,
  lerPalavras,
  marcasBemFormadas,
  MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS,
  MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS_MAIS_DEVAGAR,
  normalizar,
  pesoPelaMaisComprida,
  publicoMaisVelho,
  temChaveNoTexto,
  textoIdentico,
  textoSemMarcas,
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
  it("R-FALA-03: toda frase termina em pausa longa, e a que o modelo já pôs fica", () => {
    const { texto } = consertarMarcas("Chegou cedo. Saiu tarde!{/} E voltou?");
    expect(texto).toBe("Chegou cedo.{//} Saiu tarde!{/} E voltou?{//}");
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

  it("R-FALA-09: o tom só sobe em pergunta de verdade, no fim dela", () => {
    const { texto } = consertarMarcas("Isso funciona?{^} Funciona sim.{^} Quer ver{^} agora?");
    expect(texto).toBe("Isso funciona?{^}{//} Funciona sim.{//} Quer ver agora?{//}");
    // a pergunta no meio do texto continua com o tom que sobe só no último
    expect(consertarMarcas("Quer ver{^} agora?{^}").texto).toBe("Quer ver agora?{^}{//}");
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
    // a chamada que é pergunta não recebe o tom que desce
    expect(consertarMarcas("Vamos conversar?", { chamadaFinal: true }).texto).not.toContain("{v}");
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
    expect(publicoMaisVelho(["Clientes idosos que moram sozinhos"])).toBe(true);
    expect(publicoMaisVelho(["Homens de 60 a 75 anos"])).toBe(true);
    expect(publicoMaisVelho(["Mulheres de 30 a 45 anos"])).toBe(false);
    expect(publicoMaisVelho(["Pessoas com 65 anos ou mais"])).toBe(true);
  });
});

describe("o resto da biblioteca", () => {
  it("as 24 regras e os quatro blocos", () => {
    expect(IDS_DAS_REGRAS_DE_FALA).toHaveLength(24);
    expect(IDS_DAS_REGRAS_DE_FALA[0]).toBe("R-FALA-01");
    expect(IDS_DAS_REGRAS_DE_FALA[23]).toBe("R-FALA-24");
    expect(BLOCOS_FALADOS).toEqual(["gancho", "corpo", "fechamento", "chamadaFinal"]);
  });

  it("o simulador põe peso na palavra mais comprida de cada frase e não muda o texto", () => {
    const original = "A mancha saiu. Foi rápido!";
    const marcado = pesoPelaMaisComprida(original);
    expect(marcado).toBe("A {p:mancha} saiu. Foi {p:rápido}!");
    expect(textoIdentico(original, marcado)).toBe(true);
  });
});
