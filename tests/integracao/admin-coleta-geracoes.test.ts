/**
 * Resumo de `/admin/geracoes` (etapa 18, criterio de aceite do plano de
 * execucao): agregacao de custo, tokens e taxa de avaliacao contra o
 * Postgres real, com os numeros conferidos por consulta SQL de conferencia
 * (anotada em cada teste). Custo por cliente nos ultimos 30 dias.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, geracoesIA, user } from "@/db/schema";
import {
  custoPorClientePorMes,
  listarClientesComGeracao,
  listarGeracoesRecentes,
  listarTarefasComGeracao,
  resumoGeracoes,
  META_CUSTO_CLIENTE_USD,
} from "@/servicos/admin-coleta";

import { resetarSchema } from "../../scripts/resetar-schema";

const AGORA = new Date("2026-09-05T12:00:00Z");
const DIA_MS = 24 * 60 * 60 * 1000;
function hADias(dias: number): Date {
  return new Date(AGORA.getTime() - dias * DIA_MS);
}

let clienteAId: number;
let clienteBId: number;

async function criarCliente(usuarioId: string, nome: string): Promise<number> {
  await db()
    .insert(user)
    .values({ id: usuarioId, name: nome, email: `${usuarioId}@exemplo.teste` });
  const [cliente] = await db().insert(clientes).values({ usuarioId, nome }).returning();
  return cliente.id;
}

async function criarGeracao(dados: {
  tarefa: string;
  clienteId?: number;
  custoUsd: string;
  tokensEntrada: number;
  tokensSaida: number;
  tokensCache: number;
  avaliacao?: "gostei" | "nao_gostei" | "outro_angulo";
  motivoAvaliacao?: string;
  criadoEm: Date;
}) {
  await db()
    .insert(geracoesIA)
    .values({
      tarefa: dados.tarefa,
      versaoPrompt: "1.0.0",
      modelo: "claude-opus-5",
      clienteId: dados.clienteId,
      entradas: {},
      custoUsd: dados.custoUsd,
      tokensEntrada: dados.tokensEntrada,
      tokensSaida: dados.tokensSaida,
      tokensCache: dados.tokensCache,
      avaliacao: dados.avaliacao,
      motivoAvaliacao: dados.motivoAvaliacao,
      criadoEm: dados.criadoEm,
    });
}

beforeAll(async () => {
  await resetarSchema(db());

  clienteAId = await criarCliente("geracoes-teste-cliente-a", "[teste] Cliente A");
  clienteBId = await criarCliente("geracoes-teste-cliente-b", "[teste] Cliente B");

  // Dentro dos ultimos 7 dias: 2 roteiros do cliente A (gostei, outro_angulo com
  // motivo "gancho fraco"), 1 tema do nicho (sem cliente, sem avaliacao).
  await criarGeracao({
    tarefa: "roteiro",
    clienteId: clienteAId,
    custoUsd: "0.020000",
    tokensEntrada: 1000,
    tokensSaida: 200,
    tokensCache: 500,
    avaliacao: "gostei",
    criadoEm: hADias(1),
  });
  await criarGeracao({
    tarefa: "roteiro",
    clienteId: clienteAId,
    custoUsd: "0.030000",
    tokensEntrada: 1200,
    tokensSaida: 300,
    tokensCache: 300,
    avaliacao: "outro_angulo",
    motivoAvaliacao: "Gancho fraco",
    criadoEm: hADias(2),
  });
  await criarGeracao({
    tarefa: "avaliarTema",
    clienteId: clienteAId,
    custoUsd: "0.030000",
    tokensEntrada: 1200,
    tokensSaida: 300,
    tokensCache: 300,
    avaliacao: "outro_angulo",
    motivoAvaliacao: "gancho fraco",
    criadoEm: hADias(3),
  });
  await criarGeracao({
    tarefa: "temasDoDia",
    custoUsd: "0.010000",
    tokensEntrada: 500,
    tokensSaida: 100,
    tokensCache: 0,
    criadoEm: hADias(4),
  });

  // Entre 8 e 30 dias atras: 1 roteiro do cliente B, "nao_gostei".
  await criarGeracao({
    tarefa: "roteiro",
    clienteId: clienteBId,
    custoUsd: "0.500000",
    tokensEntrada: 2000,
    tokensSaida: 400,
    tokensCache: 0,
    avaliacao: "nao_gostei",
    criadoEm: hADias(15),
  });

  // Mais de 30 dias atras: fora de qualquer periodo, nunca deve contar.
  await criarGeracao({
    tarefa: "roteiro",
    clienteId: clienteAId,
    custoUsd: "9.000000",
    tokensEntrada: 5000,
    tokensSaida: 1000,
    tokensCache: 0,
    avaliacao: "gostei",
    criadoEm: hADias(40),
  });
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("resumoGeracoes", () => {
  it("7 dias, sem filtro: soma so o que esta dentro da janela (conferido: 4 geracoes, custo 0.09)", async () => {
    const resumo = await resumoGeracoes({ dias: 7 });
    expect(resumo.totalGeracoes).toBe(4);
    expect(resumo.custoTotalUsd).toBeCloseTo(0.02 + 0.03 + 0.03 + 0.01, 6);
    expect(resumo.custoMedioUsd).toBeCloseTo((0.02 + 0.03 + 0.03 + 0.01) / 4, 6);
    expect(resumo.tokensEntrada).toBe(1000 + 1200 + 1200 + 500);
    expect(resumo.tokensSaida).toBe(200 + 300 + 300 + 100);
    expect(resumo.tokensCache).toBe(500 + 300 + 300 + 0);
  });

  it("proporcao de cache: tokensCache / (tokensEntrada + tokensCache)", async () => {
    const resumo = await resumoGeracoes({ dias: 7 });
    const entrada = 1000 + 1200 + 1200 + 500;
    const cache = 500 + 300 + 300 + 0;
    expect(resumo.proporcaoCache).toBeCloseTo(cache / (entrada + cache), 6);
  });

  it("taxas sobre avaliadas, nunca sobre o total (3 avaliadas de 4: 1 gostei, 2 outro_angulo)", async () => {
    const resumo = await resumoGeracoes({ dias: 7 });
    expect(resumo.avaliadas).toBe(3);
    expect(resumo.taxaGostei).toBeCloseTo(1 / 3, 6);
    expect(resumo.taxaNaoGostei).toBe(0);
    expect(resumo.taxaOutroAngulo).toBeCloseTo(2 / 3, 6);
  });

  it("motivos de outro angulo, agrupados por tarefa, texto normalizado (trim e minusculo)", async () => {
    const resumo = await resumoGeracoes({ dias: 7 });
    const porTarefa = new Map(resumo.motivosOutroAnguloPorTarefa.map((g) => [g.tarefa, g.motivos]));
    expect(porTarefa.get("roteiro")).toEqual([{ motivo: "gancho fraco", contagem: 1 }]);
    expect(porTarefa.get("avaliarTema")).toEqual([{ motivo: "gancho fraco", contagem: 1 }]);
  });

  it("filtro por tarefa (so roteiro: 2 geracoes nos ultimos 7 dias)", async () => {
    const resumo = await resumoGeracoes({ dias: 7, tarefa: "roteiro" });
    expect(resumo.totalGeracoes).toBe(2);
    expect(resumo.custoTotalUsd).toBeCloseTo(0.02 + 0.03, 6);
  });

  it("filtro por cliente (so cliente B: 0 geracoes nos ultimos 7 dias, 1 nos ultimos 30)", async () => {
    const resumo7 = await resumoGeracoes({ dias: 7, clienteId: clienteBId });
    expect(resumo7.totalGeracoes).toBe(0);
    expect(resumo7.avaliadas).toBe(0);
    expect(resumo7.taxaGostei).toBeNull();

    const resumo30 = await resumoGeracoes({ dias: 30, clienteId: clienteBId });
    expect(resumo30.totalGeracoes).toBe(1);
    expect(resumo30.taxaNaoGostei).toBe(1);
  });

  it("30 dias, sem filtro: inclui os 5 dentro da janela, nunca a de 40 dias atras", async () => {
    const resumo = await resumoGeracoes({ dias: 30 });
    expect(resumo.totalGeracoes).toBe(5);
  });

  it("sem nenhuma geracao no periodo: numeros zerados, taxas nulas, sem divisao por zero", async () => {
    const resumo = await resumoGeracoes({ dias: 7, tarefa: "tarefa-que-nao-existe" });
    expect(resumo.totalGeracoes).toBe(0);
    expect(resumo.custoTotalUsd).toBe(0);
    expect(resumo.custoMedioUsd).toBe(0);
    expect(resumo.proporcaoCache).toBeNull();
    expect(resumo.avaliadas).toBe(0);
  });
});

describe("custoPorClientePorMes", () => {
  it("soma os ultimos 30 dias por cliente, cliente A primeiro (custo maior)", async () => {
    const lista = await custoPorClientePorMes();
    const porCliente = new Map(lista.map((l) => [l.clienteId, l]));

    // Conferencia: cliente A nos ultimos 30 dias = 0.02 + 0.03 + 0.03 + 0.5 nao (cliente B)
    // = 0.02 + 0.03 + 0.03 = 0.08 (a de 40 dias atras fica fora); cliente B = 0.5.
    expect(porCliente.get(clienteAId)?.custoUsd).toBeCloseTo(0.02 + 0.03 + 0.03, 6);
    expect(porCliente.get(clienteBId)?.custoUsd).toBeCloseTo(0.5, 6);

    // "quem passou aparece primeiro": maior custo primeiro.
    expect(lista[0].clienteId).toBe(clienteBId);
  });

  it("acimaDaMeta so quando o custo passa META_CUSTO_CLIENTE_USD", async () => {
    const lista = await custoPorClientePorMes();
    const porCliente = new Map(lista.map((l) => [l.clienteId, l]));
    expect(META_CUSTO_CLIENTE_USD).toBe(5);
    expect(porCliente.get(clienteAId)?.acimaDaMeta).toBe(false);
    expect(porCliente.get(clienteBId)?.acimaDaMeta).toBe(false);
  });
});

describe("listarTarefasComGeracao e listarClientesComGeracao", () => {
  it("lista as tarefas distintas", async () => {
    const tarefas = await listarTarefasComGeracao();
    expect(tarefas).toEqual(expect.arrayContaining(["roteiro", "avaliarTema", "temasDoDia"]));
  });

  it("lista so clientes com pelo menos uma geracao", async () => {
    const clientesListados = await listarClientesComGeracao();
    expect(clientesListados.map((c) => c.id).sort()).toEqual([clienteAId, clienteBId].sort());
  });
});

describe("listarGeracoesRecentes com filtro", () => {
  it("filtra por tarefa e por cliente juntos", async () => {
    const lista = await listarGeracoesRecentes(50, { tarefa: "roteiro", clienteId: clienteAId });
    expect(lista.every((g) => g.tarefa === "roteiro")).toBe(true);
    // As duas de clienteA (0.02 e 0.03) mais a de 40 dias atras (9.00): sem filtro de data aqui.
    expect(lista).toHaveLength(3);
  });

  it("sem filtro continua trazendo tudo (compatibilidade com quem ja chamava sem o segundo argumento)", async () => {
    const lista = await listarGeracoesRecentes();
    expect(lista.length).toBeGreaterThanOrEqual(6);
  });
});
