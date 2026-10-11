/** A entrega da pesquisa (E54, parte 2): o que o modelo devolveu, depois do código, e o que o modelo recebe. */
import { describe, expect, it } from "vitest";

import type { AchadoDaPesquisa, PesquisaDeOrigemGuardada } from "@/db/schema";
import { textosRoteiro } from "@/textos/roteiro";

import { dataPorExtensoDaPagina, detectarCuidados, montarEntregaDaPesquisa, paraEntradaDaPesquisa, type ContextoDaEntrega } from "./entrega-da-pesquisa";

const dado = (id: number, extra: Partial<AchadoDaPesquisa> = {}): AchadoDaPesquisa => ({
  id,
  texto: `Dado ${id}.`,
  fonteNome: "IBGE",
  fonteTipo: "oficial",
  url: `https://www.ibge.gov.br/${id}`,
  titulo: null,
  dataDaPagina: "2026-08-31",
  dataTexto: "August 31, 2026",
  antigo: false,
  citacao: `Trecho ${id}.`,
  ...extra,
});

const pesquisa = (extra: Partial<PesquisaDeOrigemGuardada> = {}): PesquisaDeOrigemGuardada => ({
  pesquisaId: 7,
  dados: [dado(1), dado(3, { fonteNome: "G1" })],
  posicaoDaPessoa: null,
  decisaoDaPremissa: null,
  avisoDaPremissa: null,
  pesquisadaEm: "2026-10-10T20:00:00.000Z",
  ...extra,
});

const entrega = (extra: Record<string, unknown> = {}) => ({
  ganchos: [
    { texto: "Gancho um.", recomendado: false },
    { texto: "Gancho dois.", recomendado: true },
    { texto: "Gancho três.", recomendado: false },
    { texto: "Gancho quatro.", recomendado: false },
  ],
  oQueVaoTeResponder: [{ objecao: "Pode aparecer: não vale para mim.", resposta: "Depende do cenário." }],
  fontes: [3],
  atencao: ["Confira o horário."],
  cuidado: "nenhum" as const,
  ...extra,
});

const contexto = (extra: Partial<ContextoDaEntrega> = {}): ContextoDaEntrega => ({ fontes: "Dado 1. Dado 3.", textoDoRoteiro: "", gancho: "", ...extra });

const T = textosRoteiro.pesquisa;

describe("dataPorExtensoDaPagina", () => {
  it("escreve a data da página por extenso, sem mexer no dia por causa do fuso", () => {
    expect(dataPorExtensoDaPagina("2026-08-31")).toBe("31 de agosto de 2026");
    expect(dataPorExtensoDaPagina("2025-01-01")).toBe("1 de janeiro de 2025");
    expect(dataPorExtensoDaPagina(null)).toBeNull();
    expect(dataPorExtensoDaPagina("ontem")).toBeNull();
  });
});

describe("paraEntradaDaPesquisa", () => {
  it("leva os dados marcados com a data por extenso, a posição e a decisão", () => {
    const entrada = paraEntradaDaPesquisa(pesquisa({ posicaoDaPessoa: "Dos dois", decisaoDaPremissa: "manter", avisoDaPremissa: "aviso" }));
    expect(entrada.dados[0]).toEqual({ id: 1, fonteNome: "IBGE", dataTexto: "31 de agosto de 2026", texto: "Dado 1.", citacao: "Trecho 1.", antigo: false });
    expect(entrada.posicaoDaPessoa).toBe("Dos dois");
    expect(entrada.decisaoDaPremissa).toBe("manter");
    // 20:00 UTC é 17:00 em São Paulo: o dia da pesquisa é o que a pessoa viu
    expect(entrada.feitaEm).toBe("10 de outubro de 2026");
  });

  it("a hora que já virou o dia em UTC continua sendo o dia que a pessoa viu em São Paulo", () => {
    // 01:30 UTC de 11/10 é 22:30 de 10/10 em São Paulo
    expect(paraEntradaDaPesquisa(pesquisa({ pesquisadaEm: "2026-10-11T01:30:00.000Z" })).feitaEm).toBe("10 de outubro de 2026");
  });

  it("data da pesquisa que não é uma data não derruba: fica sem o dia", () => {
    expect(paraEntradaDaPesquisa(pesquisa({ pesquisadaEm: "ontem" })).feitaEm).toBeNull();
  });
});

describe("detectarCuidados", () => {
  it("política, saúde e preço pelo que o texto diz", () => {
    expect(detectarCuidados("A PEC da reforma passou no Congresso")).toEqual(["politica"]);
    expect(detectarCuidados("Novo tratamento aprovado pela Anvisa")).toEqual(["saude"]);
    expect(detectarCuidados("O preço do combustível subiu")).toEqual(["preco"]);
    expect(detectarCuidados("Dicas de organização da loja")).toEqual([]);
  });

  it("só a palavra inteira conta: 'impecável' não é PEC e 'curadoria' não é cura", () => {
    expect(detectarCuidados("Um acabamento impecável")).toEqual([]);
    expect(detectarCuidados("Curadoria de produtos")).toEqual([]);
  });
});

describe("montarEntregaDaPesquisa", () => {
  it("sem entrega ou sem pesquisa, nada", () => {
    expect(montarEntregaDaPesquisa(null, pesquisa())).toBeNull();
    expect(montarEntregaDaPesquisa(undefined, pesquisa())).toBeNull();
    expect(montarEntregaDaPesquisa(entrega(), null)).toBeNull();
  });

  it("o primeiro gancho é sempre o recomendado, são no máximo três e sem repetir", () => {
    const r = montarEntregaDaPesquisa(
      entrega({
        ganchos: [
          { texto: "A", recomendado: false },
          { texto: "A", recomendado: true },
          { texto: "B", recomendado: true },
          { texto: "C", recomendado: false },
          { texto: "D", recomendado: false },
        ],
      }),
      pesquisa(),
      contexto(),
    )!;
    expect(r.ganchos).toEqual([
      { texto: "A", recomendado: true },
      { texto: "B", recomendado: false },
      { texto: "C", recomendado: false },
    ]);
  });

  it("no Reels falado o gancho do roteiro vem primeiro e é o recomendado, mesmo que o modelo tenha marcado outro", () => {
    const r = montarEntregaDaPesquisa(entrega(), pesquisa(), contexto({ gancho: "Gancho do roteiro." }))!;
    expect(r.ganchos[0]).toEqual({ texto: "Gancho do roteiro.", recomendado: true });
    expect(r.ganchos.slice(1).every((g) => !g.recomendado)).toBe(true);
    expect(r.ganchos).toHaveLength(3);
  });

  it("o gancho alternativo com número que as fontes não têm sai; o do roteiro fica (ele já passou no verificador)", () => {
    const r = montarEntregaDaPesquisa(
      entrega({ ganchos: [{ texto: "Você perde 40% do dinheiro.", recomendado: false }, { texto: "Gancho limpo.", recomendado: false }] }),
      pesquisa(),
      contexto({ gancho: "Gancho do roteiro." }),
    )!;
    expect(r.ganchos.map((g) => g.texto)).toEqual(["Gancho do roteiro.", "Gancho limpo."]);
  });

  it("as fontes são só ids de dados que a pessoa marcou; sem nenhum, valem todos os marcados", () => {
    expect(montarEntregaDaPesquisa(entrega({ fontes: [3, 99, 3] }), pesquisa(), contexto())!.fontes).toEqual([3]);
    expect(montarEntregaDaPesquisa(entrega({ fontes: [99] }), pesquisa(), contexto())!.fontes).toEqual([1, 3]);
    expect(montarEntregaDaPesquisa(entrega({ fontes: [] }), pesquisa(), contexto())!.fontes).toEqual([1, 3]);
  });

  it("o que o roteiro usou entra nas fontes por código, mesmo que o modelo não tenha dito (pelo número ou pelo nome da fonte)", () => {
    const base = pesquisa({ dados: [dado(1, { texto: "A taxa é de 12%." }), dado(3, { fonteNome: "G1", texto: "Sem número." })] });
    const r = montarEntregaDaPesquisa(entrega({ fontes: [3] }), base, contexto({ fontes: "A taxa é de 12%. Sem número.", textoDoRoteiro: "A taxa é de 12% ao ano." }))!;
    expect(r.fontes).toEqual([3, 1]);
    const porNome = montarEntregaDaPesquisa(entrega({ fontes: [1] }), base, contexto({ fontes: "A taxa é de 12%. Sem número.", textoDoRoteiro: "Segundo o G1, é assim." }))!;
    expect(porNome.fontes).toEqual([1, 3]);
  });

  describe("o que pode aparecer", () => {
    it("sai limpo: no máximo quatro, sem par vazio", () => {
      const muitas = Array.from({ length: 6 }, (_, i) => ({ objecao: `Pode aparecer: ${i}`, resposta: `Resposta ${i}` }));
      const r = montarEntregaDaPesquisa(entrega({ oQueVaoTeResponder: [{ objecao: "", resposta: "x" }, { objecao: "y", resposta: "  " }, ...muitas] }), pesquisa(), contexto())!;
      expect(r.oQueVaoTeResponder).toHaveLength(4);
      expect(r.oQueVaoTeResponder[0].objecao).toBe("Pode aparecer: 0");
    });

    it("sem o prefixo, o código põe 'Pode aparecer:' e baixa a primeira letra", () => {
      const r = montarEntregaDaPesquisa(entrega({ oQueVaoTeResponder: [{ objecao: "Isso vale para mim?", resposta: "Depende." }] }), pesquisa(), contexto())!;
      expect(r.oQueVaoTeResponder[0].objecao).toBe("Pode aparecer: isso vale para mim?");
    });

    it("previsão de público sai, e a pergunta do público fica", () => {
      const r = montarEntregaDaPesquisa(
        entrega({
          oQueVaoTeResponder: [
            { objecao: "Vão dizer que é exagero.", resposta: "Mostre o dado." },
            { objecao: "O público vai reclamar do preço.", resposta: "Explique." },
            { objecao: "Vai funcionar no meu caso?", resposta: "Depende do seu cenário." },
          ],
        }),
        pesquisa(),
        contexto(),
      )!;
      expect(r.oQueVaoTeResponder.map((o) => o.objecao)).toEqual(["Pode aparecer: vai funcionar no meu caso?"]);
    });

    it("número que as fontes não têm sai da objeção e da resposta; o das fontes fica", () => {
      const base = pesquisa({ dados: [dado(1, { texto: "A taxa é de 12%." })] });
      const r = montarEntregaDaPesquisa(
        entrega({
          fontes: [1],
          oQueVaoTeResponder: [
            { objecao: "Pode aparecer: e se for 30%?", resposta: "Mostre o dado." },
            { objecao: "Pode aparecer: dúvida sobre a taxa.", resposta: "Ela é de 87% para todos." },
            { objecao: "Pode aparecer: dúvida sobre a taxa de 12%.", resposta: "Mostre a fonte." },
          ],
        }),
        base,
        contexto({ fontes: "A taxa é de 12%." }),
      )!;
      expect(r.oQueVaoTeResponder).toHaveLength(1);
      expect(r.oQueVaoTeResponder[0].objecao).toContain("12%");
    });
  });

  describe("o atenção", () => {
    it("leva primeiro o que é regra (premissa mantida, cuidado, dado antigo ou sem data) e depois o que o modelo escreveu", () => {
      const base = pesquisa({
        dados: [dado(1, { antigo: true, dataDaPagina: "2024-01-10" }), dado(3, { dataDaPagina: null, fonteNome: "G1" })],
        decisaoDaPremissa: "manter",
        avisoDaPremissa: "O que você escreveu não bate com as fontes: é uma PEC, não um decreto.",
      });
      const r = montarEntregaDaPesquisa(entrega({ fontes: [1, 3], cuidado: "politica" }), base, contexto({ fontes: "Dado 1. Dado 3." }))!;
      expect(r.atencao[0]).toBe(T.premissaMantida("É uma PEC, não um decreto."));
      expect(r.atencao).toContain(T.cuidado.politica);
      expect(r.atencao).toContain(T.dadoAntigo("IBGE", "10 de janeiro de 2024"));
      expect(r.atencao).toContain(T.dadoSemData("G1"));
      expect(r.atencao[r.atencao.length - 1]).toBe("Confira o horário.");
      expect(r.atencao.filter((a) => a === T.cuidado.politica)).toHaveLength(1);
    });

    it("só os dados que o roteiro usou entram no aviso de data (o que ficou de fora não pede conferência)", () => {
      const base = pesquisa({ dados: [dado(1, { antigo: true }), dado(3)] });
      const r = montarEntregaDaPesquisa(entrega({ fontes: [3], atencao: [] }), base, contexto())!;
      expect(r.atencao).toEqual([]);
    });

    it("decidir 'fontes' ou 'mudar' não leva aviso de premissa para o atenção", () => {
      const r = montarEntregaDaPesquisa(entrega({ atencao: [] }), pesquisa({ decisaoDaPremissa: "fontes", avisoDaPremissa: "aviso" }), contexto())!;
      expect(r.atencao).toEqual([]);
    });

    it("o cuidado sai por código do que o roteiro e os dados dizem, mesmo que o modelo tenha dito 'nenhum'", () => {
      const base = pesquisa({ dados: [dado(1, { texto: "O preço subiu." })] });
      const r = montarEntregaDaPesquisa(entrega({ fontes: [1], atencao: [], cuidado: "nenhum" }), base, contexto({ fontes: "O preço subiu.", textoDoRoteiro: "O preço subiu." }))!;
      expect(r.atencao).toEqual([T.cuidado.preco]);
    });

    it("o item do modelo com número fora das fontes ou com endereço sai, sem derrubar os outros", () => {
      const r = montarEntregaDaPesquisa(
        entrega({ atencao: ["Confira que são 45% do total.", "Veja em https://exemplo.com.br.", "Confira o horário."] }),
        pesquisa(),
        contexto(),
      )!;
      expect(r.atencao).toEqual(["Confira o horário."]);
    });

    it("a frase de premissa mantida nunca é a cortada: o aviso longo é que encolhe", () => {
      const longo = `O que você escreveu não bate com as fontes: ${"palavra ".repeat(80)}fim.`;
      const r = montarEntregaDaPesquisa(entrega({ atencao: [] }), pesquisa({ decisaoDaPremissa: "manter", avisoDaPremissa: longo }), contexto())!;
      expect(r.atencao[0].endsWith("Você decidiu seguir com o que escreveu: confira antes de postar.")).toBe(true);
    });

    it("a frase que o modelo repete, igual à do código ou a outra dele, aparece uma vez só", () => {
      const r = montarEntregaDaPesquisa(
        entrega({ cuidado: "politica", atencao: [T.cuidado.politica, "Confira o horário.", "confira o horário", "Confira o horário!"] }),
        pesquisa(),
        contexto(),
      )!;
      expect(r.atencao.filter((a) => a === T.cuidado.politica)).toHaveLength(1);
      expect(r.atencao.filter((a) => /horário/i.test(a))).toHaveLength(1);
    });

    it("no máximo oito frases", () => {
      const r = montarEntregaDaPesquisa(entrega({ atencao: Array.from({ length: 12 }, (_, i) => `Item ${i}.`) }), pesquisa(), contexto())!;
      expect(r.atencao).toHaveLength(8);
    });
  });

  it("limpa travessão, marcador e negrito do que o modelo escreveu", () => {
    const travessao = String.fromCharCode(0x2014);
    const r = montarEntregaDaPesquisa(
      entrega({ atencao: [`- **Confira o horário** ${travessao} hoje.`], ganchos: [{ texto: `Gancho ${travessao} um`, recomendado: true }] }),
      pesquisa(),
      contexto(),
    )!;
    expect(r.atencao).toEqual(["Confira o horário, hoje."]);
    expect(r.ganchos[0].texto).toBe("Gancho, um");
  });
});
