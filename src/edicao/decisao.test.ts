import { describe, expect, it } from "vitest";

import type { DecisaoDaEdicao } from "@/db/schema";

import { correcoesAplicaveis, intervalosDaDecisao, montarPlano, validarDecisao } from "./decisao";
import { montarFalaSintetica } from "./sintetica";

/**
 * Um vídeo falado com duas tentativas da abertura, uma conversa solta no começo e um nome de marca que o transcritor ouviu errado ("Dr.Uosh" em vez de "Dr.Wash").
 * Frases (índices de palavra): 0 conversa solta; 1 abertura largada pela metade; 2 abertura completa; 3 corpo; 4 fechamento.
 */
function cenario() {
  return montarFalaSintetica([
    { texto: "Pode gravar agora" },
    { texto: "Você sabe por que a mancha", pausaAntes: 1.5 },
    { texto: "Você sabe por que a mancha de café volta sempre?", pausaAntes: 1.3 },
    { texto: "O segredo é passar o Dr.Uosh na direção certa.", pausaAntes: 0.5 },
    { texto: "Experimente hoje e me conte como ficou.", pausaAntes: 0.5 },
  ]);
}

function decisaoBoa(f: ReturnType<typeof cenario>): DecisaoDaEdicao {
  return {
    trechos: [{ deIndice: f.faixas[2].deIndice, ateIndice: f.faixas[4].ateIndice, motivo: "abertura completa até o fim", transicao: "nenhuma" }],
    gancho: { deIndice: f.faixas[2].deIndice, ateIndice: f.faixas[2].ateIndice, tentativasDescartadas: 1, porQue: "a completa" },
    titulo: { texto: "Por que a mancha volta sempre?", subtitulo: null },
    correcoesDaLegenda: [{ de: "Dr.Uosh", para: "Dr.Wash" }],
    avisos: [],
  };
}

describe("validarDecisao", () => {
  const f = cenario();
  const boa = decisaoBoa(f);

  it("aceita uma decisão coerente", () => {
    expect(validarDecisao(boa, f.palavras)).toEqual([]);
  });

  it("recusa índice que não existe, fora de ordem ou sobreposto, com a frase que o modelo entende", () => {
    const total = f.palavras.length;
    const fora = { ...boa, trechos: [{ ...boa.trechos[0], ateIndice: total + 3 }] };
    expect(validarDecisao(fora, f.palavras)[0]).toContain("não existe");
    const invertido = { ...boa, trechos: [{ ...boa.trechos[0], deIndice: 10, ateIndice: 5 }] };
    expect(validarDecisao(invertido, f.palavras)[0]).toContain("depois do fim");
    const sobreposto = {
      ...boa,
      trechos: [
        { ...boa.trechos[0], deIndice: 8, ateIndice: 20 },
        { ...boa.trechos[0], deIndice: 15, ateIndice: 25 },
      ],
    };
    expect(validarDecisao(sobreposto, f.palavras).join(" ")).toContain("sem se sobrepor");
    expect(validarDecisao({ ...boa, trechos: [] }, f.palavras)).toEqual(["a decisão não tem nenhum trecho que fica"]);
  });

  it("recusa abertura escolhida fora do primeiro trecho", () => {
    const g = { ...boa, gancho: { ...boa.gancho, deIndice: f.faixas[0].deIndice, ateIndice: f.faixas[0].ateIndice } };
    expect(validarDecisao(g, f.palavras).join(" ")).toContain("dentro do primeiro trecho");
  });

  it("recusa a decisão que corta quase a fala inteira", () => {
    const pouco = { ...boa, trechos: [{ ...boa.trechos[0], deIndice: 20, ateIndice: 21 }], gancho: { ...boa.gancho, deIndice: 20, ateIndice: 21 } };
    expect(validarDecisao(pouco, f.palavras).join(" ")).toMatch(/deixa só 2 de \d+ palavras/);
  });
});

describe("intervalosDaDecisao", () => {
  it("converte índice em tempo (início da primeira palavra ao fim da última) e funde trechos colados sem transição", () => {
    const f = cenario();
    const d = decisaoBoa(f);
    const [a] = intervalosDaDecisao(d, f.palavras);
    expect(a.de).toBe(f.palavras[d.trechos[0].deIndice].inicio);
    expect(a.ate).toBe(f.palavras[d.trechos[0].ateIndice].fim);

    const dividido: DecisaoDaEdicao = {
      ...d,
      trechos: [
        { deIndice: d.trechos[0].deIndice, ateIndice: 20, motivo: "a", transicao: "nenhuma" },
        { deIndice: 21, ateIndice: d.trechos[0].ateIndice, motivo: "b", transicao: "nenhuma" },
      ],
    };
    expect(intervalosDaDecisao(dividido, f.palavras)).toHaveLength(1);
    const comTransicao: DecisaoDaEdicao = { ...dividido, trechos: [dividido.trechos[0], { ...dividido.trechos[1], transicao: "combinar" }] };
    const dois = intervalosDaDecisao(comTransicao, f.palavras);
    expect(dois).toHaveLength(2);
    expect(dois[0].transicao).toBeUndefined();
    expect(dois[1].transicao).toBe("combinar");
  });
});

describe("correcoesAplicaveis", () => {
  const f = cenario();
  it("só vale correção cujo `de` existe de verdade na fala e cujo `para` é limpo", () => {
    const d = decisaoBoa(f);
    d.correcoesDaLegenda = [
      { de: "Dr.Uosh", para: "Dr.Wash" },
      { de: "palavra que ninguém falou", para: "Outra" },
      { de: "mancha", para: "mancha" },
      { de: "segredo", para: `segredo ${String.fromCharCode(0x2014)} verdadeiro` },
      { de: "sempre", para: "" },
    ];
    const r = correcoesAplicaveis(d, f.palavras);
    expect(r.pares).toEqual([["Dr.Uosh", "Dr.Wash"]]);
    expect(r.ignoradas).toBe(4);
  });
});

describe("montarPlano", () => {
  it("tira a conversa solta e a abertura largada, deixa a abertura completa, e a legenda sai com o nome certo", () => {
    const f = cenario();
    const plano = montarPlano({ palavras: f.palavras, energia: f.energia, decisao: decisaoBoa(f) });
    expect(plano.ok).toBe(true);
    if (!plano.ok) return;
    expect(plano.edl.palavrasMantidas[0]).toBe(f.faixas[2].deIndice);
    expect(plano.edl.palavrasMantidas).toHaveLength(f.faixas[4].ateIndice - f.faixas[2].deIndice + 1);
    expect(plano.edl.alertas).toEqual([]);
    // O vídeo abre na abertura completa: o primeiro trecho começa perto do início dela, não da conversa solta.
    expect(plano.edl.trechos[0].origem[0]).toBeGreaterThan(f.palavras[f.faixas[1].ateIndice].fim);
    const legenda = plano.legenda.blocos.map((b) => b.texto).join(" ");
    expect(legenda).toContain("DR.WASH");
    expect(legenda).not.toContain("UOSH");
    expect(legenda).not.toContain("PODE GRAVAR");
    expect(plano.legenda.srt).toContain("-->");
  });

  it("devolve problemas, sem lançar, quando a decisão não presta", () => {
    const f = cenario();
    const ruim = decisaoBoa(f);
    ruim.trechos = [{ deIndice: 500, ateIndice: 510, motivo: "x", transicao: "nenhuma" }];
    const plano = montarPlano({ palavras: f.palavras, energia: f.energia, decisao: ruim });
    expect(plano.ok).toBe(false);
    if (!plano.ok) expect(plano.problemas[0]).toContain("não existe");
  });

  it("uma troca de assunto pedida pela decisão vira transição no plano de corte", () => {
    const f = montarFalaSintetica([
      { texto: "Primeiro erro é deixar a mancha secar demais" },
      { texto: "O segundo erro é esfregar com força na direção errada", pausaAntes: 1.4 },
      { texto: "Experimente hoje e me conte como ficou", pausaAntes: 0.8 },
    ]);
    const d: DecisaoDaEdicao = {
      trechos: [
        { deIndice: f.faixas[0].deIndice, ateIndice: f.faixas[0].ateIndice, motivo: "primeiro assunto", transicao: "nenhuma" },
        { deIndice: f.faixas[1].deIndice, ateIndice: f.faixas[2].ateIndice, motivo: "segundo assunto", transicao: "combinar" },
      ],
      gancho: { deIndice: f.faixas[0].deIndice, ateIndice: f.faixas[0].ateIndice, tentativasDescartadas: 0, porQue: "única" },
      titulo: { texto: "Dois erros que estragam tudo", subtitulo: null },
      correcoesDaLegenda: [],
      avisos: [],
    };
    const plano = montarPlano({ palavras: f.palavras, energia: f.energia, decisao: d });
    expect(plano.ok).toBe(true);
    if (!plano.ok) return;
    expect(plano.edl.trechos.length).toBeGreaterThanOrEqual(2);
    expect(plano.edl.trechos.some((t) => t.transicaoEntrada === "combinar")).toBe(true);
  });
});
