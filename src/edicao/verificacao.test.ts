import { describe, expect, it } from "vitest";

import type { Edl, Legendas } from "./tipos";
import { conferirLocal, conferirTitulo, limparAvisos, nomesParaGrafar, nomesParecidosNaLegenda, numerosDoTexto } from "./verificacao";

describe("nomesParaGrafar", () => {
  it("junta marca, lugar e concorrentes, sem vazio nem repetido", () => {
    expect(nomesParaGrafar({ nomeDaMarca: "Dr.Wash", cidade: "Campinas", regiao: "campinas", concorrentes: ["Vanish", " ", "dr.wash"] })).toEqual(["Dr.Wash", "campinas", "Vanish"]);
  });
});

describe("nomesParecidosNaLegenda", () => {
  it("acha o nome escrito quase certo, também quando ficou separado em duas palavras", () => {
    expect(nomesParecidosNaLegenda("USE O DR.UOSH NA DIREÇÃO", ["Dr.Wash"])).toEqual([{ nome: "Dr.Wash", achado: "dr uosh" }]);
    expect(nomesParecidosNaLegenda("O SORRIZO DA CLÍNICA", ["Sorriso"])).toEqual([{ nome: "Sorriso", achado: "sorrizo" }]);
  });
  it("não reclama do nome certo, em caixa alta, com ou sem espaço e ponto", () => {
    expect(nomesParecidosNaLegenda("USE O DR.WASH E O DR WASH E O DRWASH", ["Dr.Wash"])).toEqual([]);
  });
  it("nome curto só vale exato, para não acusar palavra comum", () => {
    expect(nomesParecidosNaLegenda("O SOL NASCEU", ["Sal"])).toEqual([]);
  });
  it("palavra comum diferente do nome não é acusada", () => {
    expect(nomesParecidosNaLegenda("A MANCHA VOLTA SEMPRE", ["Dr.Wash", "Campinas"])).toEqual([]);
  });
});

describe("numerosDoTexto", () => {
  it("lê dígitos, números com ponto e vírgula, e números por extenso", () => {
    const n = numerosDoTexto("São 3.956 reais, três erros e 50% a mais, uns 2,5 anos");
    expect(n.has("3956")).toBe(true);
    expect(n.has("3")).toBe(true);
    expect(n.has("50")).toBe(true);
    expect(n.has("25")).toBe(true);
  });
});

describe("conferirTitulo", () => {
  const fala = "Você sabe por que a mancha volta? São três erros comuns e custa 49 reais";
  const roteiro = "Por que a mancha de café volta sempre. Três erros.";
  it("aceita pergunta curta que nasce da fala", () => {
    expect(conferirTitulo({ texto: "Por que a mancha volta sempre?", subtitulo: "Dr.Wash" }, fala, roteiro)).toEqual([]);
    expect(conferirTitulo({ texto: "3 erros que deixam a mancha voltar", subtitulo: null }, fala, roteiro)).toEqual([]);
  });
  it("reprova número que ninguém falou", () => {
    const p = conferirTitulo({ texto: "Economize 999 reais hoje", subtitulo: null }, fala, roteiro);
    expect(p.join(" ")).toContain("número 999");
  });
  it("reprova promessa que o roteiro não faz, mas aceita a que o roteiro já faz", () => {
    expect(conferirTitulo({ texto: "Resultado garantido na primeira vez", subtitulo: null }, fala, roteiro).join(" ")).toContain("promete");
    expect(conferirTitulo({ texto: "Resultado garantido na primeira vez", subtitulo: null }, fala, `${roteiro} Resultado garantido.`)).toEqual([]);
  });
  it("reprova título grande, com exclamação, emoji, aspas e subtítulo grande", () => {
    expect(conferirTitulo({ texto: "Uma duas três quatro cinco seis sete oito nove dez onze doze", subtitulo: null }, fala, roteiro).join(" ")).toContain("grande demais");
    expect(conferirTitulo({ texto: "Olha isso!", subtitulo: null }, fala, roteiro).join(" ")).toContain("exclamação");
    expect(conferirTitulo({ texto: "A mancha volta \u{1F525}", subtitulo: null }, fala, roteiro).join(" ")).toContain("emoji");
    expect(conferirTitulo({ texto: 'A "mancha" volta', subtitulo: null }, fala, roteiro).join(" ")).toContain("aspas");
    expect(conferirTitulo({ texto: "A mancha volta", subtitulo: "uma marca de produtos de limpeza que atende toda a cidade" }, fala, roteiro).join(" ")).toContain("subtítulo é grande");
    expect(conferirTitulo({ texto: "   ", subtitulo: null }, fala, roteiro)).toEqual(["o título está vazio"]);
  });
});

describe("limparAvisos", () => {
  it("fica com até 3 avisos limpos, sem repetir, sem emoji nem texto enorme", () => {
    const avisos = limparAvisos(["Você falou 49 e o roteiro diz 59.", "você falou 49 e o roteiro diz 59", "Com emoji \u{1F600}", "x".repeat(300), "Não gravou a chamada final.", "Terceiro.", "Quarto."]);
    expect(avisos).toEqual(["Você falou 49 e o roteiro diz 59.", "Não gravou a chamada final.", "Terceiro."]);
  });
});

describe("conferirLocal", () => {
  const edl = { alertas: [] } as unknown as Edl;
  const legenda = (texto: string): Legendas => ({ blocos: [{ inicio: 0, fim: 1, texto }], srt: "", palavrasChave: [] });
  const base = { edl, titulo: { texto: "Por que volta?", subtitulo: null }, palavras: [], textoDoRoteiro: "volta", nomes: ["Dr.Wash"] };

  it("lista vazia quando está tudo certo", () => {
    expect(conferirLocal({ ...base, legenda: legenda("USE O DR.WASH") })).toEqual([]);
  });
  it("leva o alerta de corte com palavra soando como motivo", () => {
    const p = conferirLocal({ ...base, edl: { alertas: ['trecho 2: corte em 3.10s com "mancha" ainda soando'] } as unknown as Edl, legenda: legenda("USE O DR.WASH") });
    expect(p.join(" ")).toContain("ainda soando");
  });
  it("reprova legenda vazia e nome escrito errado", () => {
    expect(conferirLocal({ ...base, legenda: { blocos: [], srt: "", palavrasChave: [] } })).toContain("a legenda ficou vazia");
    expect(conferirLocal({ ...base, legenda: legenda("USE O DR.UOSH") }).join(" ")).toContain('"Dr.Wash" aparece na legenda como "dr uosh"');
  });
});
