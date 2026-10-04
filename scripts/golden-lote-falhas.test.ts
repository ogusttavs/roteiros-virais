/**
 * O golden set pelo lote quando algo falha (ajuste da revisão do #124): um caso que o lote devolve com erro ou expirado vira `Error` na posição dele e os outros seguem; um erro de
 * rede na consulta do lote (já pago) é tentado de novo antes de desistir; e os scripts imprimem o caso falho com o motivo e contam, em vez de derrubar a rodada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { construirSaidaMock } from "../src/ia/mock";
import * as avaliarTemaIA from "../src/ia/prompts/avaliarTema";

import { avaliarTemas } from "./avaliar-temas";
import { gerarVarios, gerarVariosOuErro } from "./golden-lote";

type Item = { customId: string; tarefa: string; entrada: string; sistemaEstavel: string };

const estado = vi.hoisted(() => ({
  itens: [] as Item[],
  /** Índices (customId) que voltam com erro; "expirado:N" volta expirado. */
  falhar: new Set<string>(),
  statusFalhas: 0,
}));

vi.mock("../src/ia/lote", () => ({
  criarLote: async (itens: Item[]) => {
    estado.itens = itens;
    return "lote-de-teste";
  },
  statusLote: async () => {
    if (estado.statusFalhas > 0) {
      estado.statusFalhas -= 1;
      throw new Error("falha de rede");
    }
    return "concluido";
  },
  coletarResultadosLote: async (_id: string, schema: { parse: (v: unknown) => unknown }) =>
    estado.itens.map((item) =>
      estado.falhar.has(item.customId)
        ? { customId: item.customId, status: "erro" as const, motivo: "saida nao validou o schema" }
        : estado.falhar.has(`expirado:${item.customId}`)
          ? { customId: item.customId, status: "expirado" as const }
          : { customId: item.customId, status: "sucesso" as const, dados: schema.parse(construirSaidaMock(item.tarefa as never, item.entrada, item.sistemaEstavel)), modelo: "mock", tokensEntrada: 0, tokensSaida: 0 },
    ),
}));

function pedido(tema: string) {
  return {
    tarefa: "avaliarTema" as const,
    nivel: avaliarTemaIA.nivel,
    effort: avaliarTemaIA.esforco,
    schema: avaliarTemaIA.schema,
    sistemaEstavel: avaliarTemaIA.montarSistemaEstavel({ perfilCompilado: "perfil", modeloNicho: "modelo", persona: "negocio", regrasCliente: [] }),
    entrada: avaliarTemaIA.montarEntrada({ tema, evidencias: [] }),
  };
}

beforeEach(() => {
  estado.itens = [];
  estado.falhar = new Set();
  estado.statusFalhas = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("o lote com falha", () => {
  it("o caso com erro ou expirado vem como Error na posição dele e os outros saem", async () => {
    estado.falhar = new Set(["1", "expirado:2"]);
    const resultados = await gerarVariosOuErro([pedido("a"), pedido("b"), pedido("c"), pedido("d")], "temas");
    expect(resultados[0]).not.toBeInstanceOf(Error);
    expect(resultados[1]).toBeInstanceOf(Error);
    expect((resultados[1] as Error).message).toContain("nao validou");
    expect(resultados[2]).toBeInstanceOf(Error);
    expect((resultados[2] as Error).message).toBe("expirado");
    expect(resultados[3]).not.toBeInstanceOf(Error);
    await expect(gerarVarios([pedido("a"), pedido("b")], "temas")).rejects.toThrow(/caso 2/);
  });

  it("um erro de rede na consulta do lote é tentado de novo, e o lote sai", async () => {
    vi.useFakeTimers();
    estado.statusFalhas = 2;
    const promessa = gerarVariosOuErro([pedido("a")], "temas");
    await vi.advanceTimersByTimeAsync(60_000);
    const [resultado] = await promessa;
    expect(resultado).not.toBeInstanceOf(Error);
  });

  it("se a consulta não volta depois das tentativas, desiste dizendo o id do lote", async () => {
    vi.useFakeTimers();
    estado.statusFalhas = 99;
    const promessa = gerarVariosOuErro([pedido("a")], "temas");
    const esperado = expect(promessa).rejects.toThrow(/lote-de-teste/);
    await vi.advanceTimersByTimeAsync(120_000);
    await esperado;
  });

  it("o script imprime o caso falho com o motivo, conta, e os outros seguem", async () => {
    estado.falhar = new Set(["1"]);
    const linhas: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void linhas.push(args.join(" ")));
    const resultado = await avaliarTemas();
    expect(resultado.casosFalhos).toBe(1);
    expect(resultado.casos).toBeGreaterThan(1);
    expect(linhas.some((l) => l.includes("[FALHOU:") && l.includes("nao validou"))).toBe(true);
    expect(linhas.some((l) => l.includes("casos que falharam no lote: 1"))).toBe(true);
  });
});
