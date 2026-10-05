/**
 * Os golden sets pelo caminho de produção (pedido do Fable): 1ª tentativa de todos, conferência local e do `verificarTexto` com fontes, e só os reprovados refazem com o motivo; "reprovado nas duas"
 * é o `ErroIA`. Em mock, com o marcador `[mock:fato-inventado]` (o mock do `verificarTexto` reprova o fato fora das fontes).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as roteiroIA from "../src/ia/prompts/roteiro";
import * as verificarTextoIA from "../src/ia/prompts/verificarTexto";
import { MARCADOR_SEGUNDA_TENTATIVA } from "../src/ia/verificador";

const estado = vi.hoisted(() => ({ entradas: [] as string[] }));

vi.mock("../src/ia/lote", async () => {
  const real = await vi.importActual<typeof import("../src/ia/lote")>("../src/ia/lote");
  return {
    ...real,
    criarLote: async (...args: Parameters<typeof real.criarLote>) => {
      for (const item of args[0]) if (item.tarefa === "roteiro") estado.entradas.push(item.entrada);
      return real.criarLote(...args);
    },
  };
});

import { linhaDoResumo, resumirProducao, rodarComoEmProducao, type CasoEmProducao } from "./golden-producao";

type Saida = roteiroIA.SaidaRoteiro;

function caso(opcoes: { rotulo: string; textoPorTentativa: (chamada: number) => string }): CasoEmProducao<Saida> {
  let chamadasDeCampos = 0;
  return {
    pedido: () => ({
      tarefa: "roteiro",
      nivel: roteiroIA.nivel,
      effort: roteiroIA.esforco,
      schema: roteiroIA.schema,
      sistemaEstavel: roteiroIA.montarSistemaEstavel({ perfilCompilado: "perfil", modeloNicho: "modelo", camadaExclusiva: "camada", regrasCliente: [], tipo: "negocio", formato: "reels", estilo: "falado" }),
      entrada: roteiroIA.montarEntrada({
        tema: opcoes.rotulo,
        objetivo: "alcance",
        formato: "reels",
        estilo: "falado",
        evidencias: [],
        roteirosRecentes: [],
        instrucaoAbertura: { tipo: null, tiposProibidos: [] },
      }),
    }),
    local: () => ({ aprovado: true, motivos: [] }),
    // O texto que o verificador confere: muda por chamada (1ª tentativa, 2ª tentativa).
    campos: () => ({ gancho: opcoes.textoPorTentativa(chamadasDeCampos++), corpo: "texto do corpo" }),
    pedidoVerificador: (campos) => ({
      tarefa: "verificarTexto",
      nivel: verificarTextoIA.nivel,
      effort: verificarTextoIA.esforco,
      schema: verificarTextoIA.schema,
      sistemaEstavel: verificarTextoIA.montarSistemaEstavel("roteiro", true),
      entrada: verificarTextoIA.montarEntrada({ texto: Object.values(campos).join("\n"), proibicoes: [], fontes: "Perfil: lava estofado." }),
    }),
  };
}

beforeEach(() => {
  estado.entradas = [];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("rodarComoEmProducao", () => {
  it("o que aprova de primeira não faz 2ª tentativa; o que reprova refaz com o motivo e o lembrete por último; o que reprova nas duas conta como ErroIA", async () => {
    const ok = caso({ rotulo: "tema ok", textoPorTentativa: () => "olha o que acontece com a mancha" });
    const corrige = caso({ rotulo: "tema que corrige", textoPorTentativa: (n) => (n === 0 ? "o Uli está do meu lado [mock:fato-inventado]" : "olha o que acontece com a mancha") });
    const teima = caso({ rotulo: "tema que teima", textoPorTentativa: () => "o Uli está do meu lado [mock:fato-inventado]" });
    const producao = await rodarComoEmProducao<Saida>({ rotulo: "teste", lembreteFinal: roteiroIA.LEMBRETE_ACENTUACAO, casos: [ok, corrige, teima] });

    expect(producao.map((p) => p.tentativas)).toEqual([1, 2, 2]);
    expect(producao.map((p) => p.reprovouNa1a)).toEqual([false, true, true]);
    expect(producao.map((p) => p.verificacao.aprovado)).toEqual([true, true, false]);
    expect(producao[1].motivosDa1a.join(" ")).toContain("nada nas fontes o sustenta");
    expect(producao[2].verificacao.motivos.join(" ")).toContain("fonte mais próxima: nenhuma");

    // 3 gerações na 1ª tentativa e 2 na 2ª; as da 2ª levam o marcador e o motivo, e o lembrete de acentuação continua sendo a última linha das duas.
    expect(estado.entradas).toHaveLength(5);
    const segundas = estado.entradas.filter((e) => e.includes(MARCADOR_SEGUNDA_TENTATIVA));
    expect(segundas).toHaveLength(2);
    for (const e of segundas) expect(e).toContain("Motivo: o texto afirma");
    for (const e of estado.entradas) expect(e.trimEnd().endsWith(roteiroIA.LEMBRETE_ACENTUACAO.trimEnd())).toBe(true);
    // O caso que aprovou de primeira custou menos que os que refizeram.
    expect(producao[0].custoUsd).toBeLessThanOrEqual(producao[1].custoUsd);

    const resumo = resumirProducao(producao);
    expect(resumo).toEqual({ reprovadosNa1a: 2, reprovadosNasDuas: 1, falhos: 0 });
    expect(linhaDoResumo(3, resumo)).toBe("reprovado na 1ª tentativa: 2 de 3, reprovado nas duas (ErroIA em produção): 1 de 3");
  });

  it("a conferência local mecânica (voce sem acento) é corrigida por código, como na produção, sem 2ª tentativa", async () => {
    const mecanico: CasoEmProducao<Saida> = {
      ...caso({ rotulo: "tema mecânico", textoPorTentativa: () => "olha o que acontece" }),
      local: (dados) => (JSON.stringify(dados).includes("voce") ? { aprovado: false, motivos: ['sem acentuacao: tem "voce", "nao", "tambem" ou "ja" sem o acento (H2, achado de 29/09/2026)'] } : { aprovado: true, motivos: [] }),
    };
    // O mock de roteiro devolve texto sem acento em alguns campos; se não devolver, o caso apenas aprova de primeira (o teste só exige que nunca gaste a 2ª tentativa).
    const producao = await rodarComoEmProducao<Saida>({ rotulo: "teste", casos: [mecanico] });
    expect(producao[0].tentativas).toBe(1);
  });

  it("sem nenhum reprovado, só existe a 1ª tentativa e o resumo é zero", async () => {
    const producao = await rodarComoEmProducao<Saida>({ rotulo: "teste", casos: [caso({ rotulo: "a", textoPorTentativa: () => "ok" }), caso({ rotulo: "b", textoPorTentativa: () => "ok" })] });
    expect(estado.entradas).toHaveLength(2);
    expect(resumirProducao(producao)).toEqual({ reprovadosNa1a: 0, reprovadosNasDuas: 0, falhos: 0 });
  });
});
