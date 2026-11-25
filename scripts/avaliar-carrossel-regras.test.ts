import { describe, expect, it } from "vitest";

import { categoriaDoMotivo, compararEmMarkdown, compararEmTexto, desfechoDasTentativas, lerTeto, motivosDoTexto, passouDoTeto, resumir, rodarComTeto, type ResultadoDoCaso, type Rodada } from "./avaliar-carrossel-regras";

const caso = (id: string, desfecho: ResultadoDoCaso["desfecho"], custoUsd: number, extra: Partial<ResultadoDoCaso> = {}): ResultadoDoCaso => ({
  id,
  nome: `tema ${id}`,
  ramo: "odontologia",
  quantidade: 5,
  desfecho,
  motivos: [],
  custoUsd,
  tempoS: 10,
  slides: [["Capa", "Subtitulo"], ["Passo 1"]],
  legenda: "legenda " + id,
  hashtags: [],
  avisos: [],
  ...extra,
});
const rodada = (versaoPrompt: string, casos: ResultadoDoCaso[]): Rodada => ({
  data: "2026-11-26T10:00:00.000Z",
  versaoPrompt,
  conjunto: "teste",
  precos: { forte: { entrada: 5, saida: 25 }, barato: { entrada: 1, saida: 5 }, datados: "2026-08" },
  tetoUsd: null,
  gastoUsd: casos.reduce((s, c) => s + c.custoUsd, 0),
  parouPeloTeto: false,
  casos,
});

describe("resumo e comparador do carrossel", () => {
  it("conta prontos na 1a, na 2a, falhas, custo e tempo medios, sem contar o que nao rodou", () => {
    const r = rodada("2.0.0", [
      caso("a", "1a", 0.1),
      caso("b", "2a", 0.3, { motivos: ["R-COPY-26: formula de maquina", "R-COPY-26: outra"], tempoS: 30 }),
      caso("c", "falhou", 0.2),
      caso("d", "nao-rodou", 0),
    ]);
    const s = resumir(r);
    expect([s.total, s.rodados, s.prontosNa1a, s.prontosNa2a, s.falhas, s.naoRodou]).toEqual([4, 3, 1, 1, 1, 1]);
    expect(s.custoTotalUsd).toBeCloseTo(0.6);
    expect(s.custoMedioUsd).toBeCloseTo(0.2);
    expect(s.tempoMedioS).toBeCloseTo(50 / 3);
    expect(s.motivosMaisComuns).toEqual([{ motivo: "R-COPY-26", vezes: 2 }]);
  });

  it("normaliza o motivo: codigo da regra vale sozinho, o resto perde numeros e aspas", () => {
    expect(categoriaDoMotivo("R-COPY-26: a capa promete")).toBe("R-COPY-26");
    expect(categoriaDoMotivo('slide 3 tem "texto longo" com 120 caracteres')).toBe('slide N tem "..." com N caracteres');
    expect(motivosDoTexto("a; b; ")).toEqual(["a", "b"]);
    expect(motivosDoTexto(null)).toEqual([]);
  });

  it("o desfecho vem do numero de tentativas e de ter dado certo", () => {
    expect(desfechoDasTentativas(true, 1)).toBe("1a");
    expect(desfechoDasTentativas(true, 2)).toBe("2a");
    expect(desfechoDasTentativas(false, 2)).toBe("falhou");
  });

  it("imprime as contagens lado a lado e o Markdown traz os textos dos dois, caso a caso", () => {
    const antes = rodada("2.0.0", [caso("a", "2a", 0.3, { motivos: ["R-COPY-26: x"] }), caso("b", "falhou", 0.2)]);
    const depois = rodada("2.1.0", [caso("a", "1a", 0.1, { legenda: "legenda nova" }), caso("b", "1a", 0.1)]);
    const texto = compararEmTexto(antes, depois);
    expect(texto).toContain("prontos na 1a");
    expect(texto).toMatch(/prontos na 1a\s+0\s+2/);
    expect(texto).toMatch(/falhas\s+1\s+0/);
    expect(texto).toContain("1 -> 0  R-COPY-26");
    const md = compararEmMarkdown(antes, depois);
    expect(md).toContain("## a");
    expect(md).toContain("## b");
    expect(md).toContain("legenda nova");
    expect(md).toContain("| Antes | Depois |");
  });
});

describe("teto de gasto da rodada", () => {
  it("passa do teto quando o gasto chega nele; sem teto nunca para", () => {
    expect(passouDoTeto(0.49, 0.5)).toBe(false);
    expect(passouDoTeto(0.5, 0.5)).toBe(true);
    expect(passouDoTeto(100, null)).toBe(false);
  });

  it("para a rodada antes do proximo caso e marca o resto como nao rodado", async () => {
    const chamados: string[] = [];
    const casos = ["a", "b", "c", "d"].map((id) => ({ id, nome: id, ramo: "x", quantidade: 5 }));
    const r = await rodarComTeto(
      casos,
      async (c) => {
        chamados.push(c.id);
        return caso(c.id, "1a", 0.3);
      },
      0.5,
    );
    expect(chamados).toEqual(["a", "b"]);
    expect(r.parouPeloTeto).toBe(true);
    expect(r.gastoUsd).toBeCloseTo(0.6);
    expect(r.casos.map((c) => c.desfecho)).toEqual(["1a", "1a", "nao-rodou", "nao-rodou"]);
  });

  it("sem estourar, roda todos", async () => {
    const r = await rodarComTeto([{ id: "a", nome: "a", ramo: "x", quantidade: 5 }], async (c) => caso(c.id, "1a", 0.1), 5);
    expect(r.parouPeloTeto).toBe(false);
    expect(r.casos).toHaveLength(1);
  });

  it("le o teto da linha de comando: padrao 5, 'sem' e 0 tiram, virgula vale", () => {
    expect(lerTeto(undefined)).toBe(5);
    expect(lerTeto("0,5")).toBe(0.5);
    expect(lerTeto("sem")).toBeNull();
    expect(lerTeto("0")).toBeNull();
    expect(() => lerTeto("abc")).toThrow();
  });
});
