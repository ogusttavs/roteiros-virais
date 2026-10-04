/** Custos do admin (E46 PR 3), contra o Postgres real: os períodos até ontem, o teto, os fixos (dólar, anual, tirar sem apagar) e o que o Início lê deles. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CAMBIO_USD_BRL, CUSTO_FIXO_MENSAL_BRL, TETO_DIARIO_BRL } from "@/config/dinheiro";
import { db, getPool } from "@/db";
import { clientes, custosFixos, geracoesIA, roteiros, user } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { adicionarFixo, custosDoAdmin, definirTetoDiario, editarFixo, ErroCusto, fixoMensalEmReais, fixoPorMesEmReais, tetoDiarioEmReais, tirarFixo } from "@/servicos/admin-custos";
import { inicioDoAdmin } from "@/servicos/admin-inicio";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA = 24 * 60 * 60 * 1000;
let contaId: number;

async function gerar(criadoEm: Date, usd: string, tarefa = "roteiro", clienteId: number | null = null) {
  await db().insert(geracoesIA).values({ tarefa, versaoPrompt: "0", modelo: "mock", entradas: {}, clienteId, custoUsd: usd, criadoEm } as never);
}

beforeAll(async () => {
  await resetarSchema(db());
  await db().insert(user).values({ id: "cu-admin", name: "Admin", email: "cu-admin@custos.teste" });
  const [c] = await db().insert(clientes).values({ nome: "[teste] Conta de custo" }).returning();
  contaId = c.id;
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

describe("custosDoAdmin", () => {
  it("sem nada: semDado, e o fixo do Início é o da apresentação", async () => {
    const c = await custosDoAdmin();
    expect(c.semDado).toBe(true);
    expect(c.porRoteiroUsd).toBeNull();
    expect(await fixoMensalEmReais()).toEqual({ total: CUSTO_FIXO_MENSAL_BRL, cadastrados: 0 });
    expect(await tetoDiarioEmReais()).toBe(TETO_DIARIO_BRL);
  });

  it("hoje fica à parte: os 7 e os 30 dias vão até ontem", async () => {
    const agora = new Date();
    await gerar(agora, "2.000000", "roteiro", contaId);
    await gerar(new Date(agora.getTime() - 1.5 * DIA), "1.000000", "roteiro", contaId);
    await gerar(new Date(agora.getTime() - 10 * DIA), "0.500000", "temasDoDia", null);
    await gerar(new Date(agora.getTime() - 40 * DIA), "9.000000", "roteiro", contaId);
    await db().insert(roteiros).values({
      clienteId: contaId,
      data: hojeISO(new Date(agora.getTime() - 2 * DIA)),
      tema: "t",
      origem: "livre",
      objetivo: "reconhecimento",
      conteudo: { gancho: "g", corpo: [], fechamento: "f", chamadaFinal: "c" },
    } as never);

    const c = await custosDoAdmin(agora);
    expect(c.semDado).toBe(false);
    expect(c.hoje.usd).toBeCloseTo(2, 5);
    expect(c.ultimos7Usd).toBeCloseTo(1, 5);
    expect(c.ultimos30Usd).toBeCloseTo(1.5, 5);
    expect(c.roteiros30).toBe(1);
    expect(c.porRoteiroUsd).toBeCloseTo(1.5, 5);
    expect(c.porConta).toEqual([{ clienteId: contaId, nome: "[teste] Conta de custo", usd: 1, roteiros: 1 }]);
    expect(c.baseDosRamosUsd).toBeCloseTo(0.5, 5);
    expect(c.porOndeVai.map((l) => l.rotulo)).toEqual(["IA: escrever os roteiros", "IA: temas do dia"]);
    expect(c.hoje.maisGastou?.rotulo).toBe("IA: escrever os roteiros");
    // 2 dólares hoje são R$ 11, abaixo do teto de R$ 20.
    expect(c.hoje.passouDoTeto).toBe(false);
  });

  it("passar do teto acende o aviso, e trocar o teto muda o limite (só avisa, nunca para nada)", async () => {
    await definirTetoDiario(5, "cu-admin");
    expect(await tetoDiarioEmReais()).toBe(5);
    const c = await custosDoAdmin();
    expect(c.hoje.passouDoTeto).toBe(true);
    await expect(definirTetoDiario(0, "cu-admin")).rejects.toBeInstanceOf(ErroCusto);
    await expect(definirTetoDiario(Number.NaN, "cu-admin")).rejects.toBeInstanceOf(ErroCusto);
    expect(await tetoDiarioEmReais()).toBe(5);
  });
});

describe("os fixos", () => {
  it("dólar entra pelo câmbio, anual dividido por 12, e a soma vale no lugar do valor da apresentação", async () => {
    expect(fixoPorMesEmReais({ valor: "60.00", moeda: "usd", periodo: "mensal" })).toBeCloseTo(60 * CAMBIO_USD_BRL, 5);
    expect(fixoPorMesEmReais({ valor: "1200.00", moeda: "brl", periodo: "anual" })).toBeCloseTo(100, 5);

    await adicionarFixo({ nome: "Servidor", valor: 109, moeda: "brl", periodo: "mensal", cobra: "todo dia 5" });
    const proxy = await adicionarFixo({ nome: "Proxy do YouTube", valor: 5, moeda: "usd", periodo: "mensal" });
    const fixo = await fixoMensalEmReais();
    expect(fixo.cadastrados).toBe(2);
    expect(fixo.total).toBeCloseTo(109 + 5 * CAMBIO_USD_BRL, 5);

    const inicio = await inicioDoAdmin();
    expect(inicio.dinheiro.fixosCadastrados).toBe(2);
    expect(inicio.dinheiro.fixosBrl).toBeCloseTo(fixo.total, 5);
    expect(inicio.dinheiro.tetoBrl).toBe(5);

    const editado = await editarFixo(proxy.id, { nome: "Proxy do YouTube", valor: 6, moeda: "usd", periodo: "mensal" });
    expect(Number(editado.valor)).toBe(6);
  });

  it("recusa nome vazio, valor negativo e moeda que não existe", async () => {
    await expect(adicionarFixo({ nome: "  ", valor: 1, moeda: "brl", periodo: "mensal" })).rejects.toBeInstanceOf(ErroCusto);
    await expect(adicionarFixo({ nome: "x", valor: -1, moeda: "brl", periodo: "mensal" })).rejects.toBeInstanceOf(ErroCusto);
    await expect(adicionarFixo({ nome: "x", valor: 1, moeda: "eur" as never, periodo: "mensal" })).rejects.toBeInstanceOf(ErroCusto);
  });

  it("tirar não apaga: a linha continua, inativa e com a data, e sai da soma", async () => {
    const [alvo] = await db().select().from(custosFixos).where(eq(custosFixos.nome, "Servidor"));
    await tirarFixo(alvo.id);
    const [depois] = await db().select().from(custosFixos).where(eq(custosFixos.id, alvo.id));
    expect(depois.ativo).toBe(false);
    expect(depois.tiradoEm).not.toBeNull();
    expect((await fixoMensalEmReais()).cadastrados).toBe(1);
    await expect(tirarFixo(alvo.id)).rejects.toBeInstanceOf(ErroCusto);
    await expect(editarFixo(alvo.id, { nome: "Servidor", valor: 1, moeda: "brl", periodo: "mensal" })).rejects.toBeInstanceOf(ErroCusto);
  });
});
