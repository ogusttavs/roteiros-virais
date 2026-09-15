/**
 * `src/servicos/aprendizado.ts` (E27, parte 2, itens 4 e 5, mais os itens 3
 * e 8a da segunda rodada do PR #42): consulta e as duas ações do cliente
 * ("Não é bem assim" e "Desfazer"), contra o Postgres real. `rodarAprender
 * Cliente` (o job que escreve as regras a partir das reprovações) já tem o
 * próprio teste, `tests/integracao/aprender-cliente.test.ts`; este arquivo
 * cobre o resto do serviço: `regrasDoCliente` (ativas e desativadas juntas,
 * Briefing e admin), `reativarRegra`, `contarReprovacoes`, e o isolamento
 * entre clientes chegando até o texto do prompt do roteiro.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { aprendizadoCliente, clientes, geracoesIA, nichos, roteiros, user } from "@/db/schema";
import { montarSistemaEstavel } from "@/ia/prompts/roteiro";
import {
  contarReprovacoes,
  desativarRegra,
  ErroAprendizado,
  reativarRegra,
  regrasAtivasDoCliente,
  regrasDoCliente,
} from "@/servicos/aprendizado";
import { textosAdmin } from "@/textos/admin";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;
let contador = 0;

async function criarCliente(): Promise<number> {
  contador += 1;
  const usuarioId = `aprendizado-teste-${contador}`;
  await db()
    .insert(user)
    .values({ id: usuarioId, name: `[teste] cliente ${contador}`, email: `${usuarioId}@aprendizado.teste` });
  const [cliente] = await db().insert(clientes).values({ usuarioId, nome: `[teste] cliente ${contador}`, nichoId }).returning();
  return cliente.id;
}

async function criarRegra(clienteId: number, regra: string, opcoes?: { ativa?: boolean }): Promise<number> {
  const [linha] = await db()
    .insert(aprendizadoCliente)
    .values({ clienteId, regra, ativa: opcoes?.ativa ?? true })
    .returning({ id: aprendizadoCliente.id });
  return linha.id;
}

/** Uma reprovação de verdade (geracoesIA + roteiros), para `contarReprovacoes` e a janela de datas. */
async function criarReprovacao(clienteId: number, motivos: string[], reprovadoEm: Date = new Date()): Promise<void> {
  const [geracao] = await db()
    .insert(geracoesIA)
    .values({
      tarefa: "roteiro",
      versaoPrompt: "1.7.1",
      modelo: "teste-fixture",
      clienteId,
      entradas: {},
      saida: {},
      avaliacao: "reprovado",
      motivosAvaliacao: motivos,
    })
    .returning();
  await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: reprovadoEm.toISOString().slice(0, 10),
      tema: "tema de teste",
      origem: "livre",
      objetivo: "engajamento",
      conteudo: {
        titulo: "titulo",
        gancho: "gancho de teste",
        corpo: "corpo de teste",
        fechamento: "fechamento",
        chamadaFinal: "chamada",
        duracaoS: 30,
        ondeGravar: "onde",
        comoEditar: { textoNaTela: [], ritmoDeCorte: "", recursos: [], audio: "", referencia: "" },
      } as never,
      geracaoId: geracao.id,
      reprovadoEm,
    });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "aprendizado-teste", nome: "Aprendizado teste", termos: [] }).returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(roteiros);
  await db().delete(geracoesIA);
  await db().delete(aprendizadoCliente);
});

describe("regrasDoCliente", () => {
  it("ordena por primeiraEm crescente, id como desempate, nao muda de lugar quando desativada (segunda rodada do PR #42, item 1)", async () => {
    const clienteId = await criarCliente();
    const idPrimeira = await criarRegra(clienteId, "primeira regra");
    await criarRegra(clienteId, "segunda regra");

    const antes = await regrasDoCliente(clienteId);
    expect(antes.map((r) => r.regra)).toEqual(["primeira regra", "segunda regra"]);

    await desativarRegra(clienteId, idPrimeira);

    const depois = await regrasDoCliente(clienteId);
    expect(depois.map((r) => r.regra)).toEqual(["primeira regra", "segunda regra"]);
    expect(depois[0]).toMatchObject({ regra: "primeira regra", ativa: false });
  });

  it("nunca mistura cliente (item 6: circula padrão, nunca conteúdo)", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    await criarRegra(clienteA, "regra do cliente a");
    await criarRegra(clienteB, "regra do cliente b");

    const regrasA = await regrasDoCliente(clienteA);
    const regrasB = await regrasDoCliente(clienteB);

    expect(regrasA.map((r) => r.regra)).toEqual(["regra do cliente a"]);
    expect(regrasB.map((r) => r.regra)).toEqual(["regra do cliente b"]);
  });

  it("cliente sem nenhuma regra devolve lista vazia (estado semAprendizado)", async () => {
    const clienteId = await criarCliente();
    expect(await regrasDoCliente(clienteId)).toEqual([]);
  });
});

describe("reativarRegra (\"Desfazer\")", () => {
  it("reativa uma regra desativada, limpando desativada_em", async () => {
    const clienteId = await criarCliente();
    const regraId = await criarRegra(clienteId, "regra desativada", { ativa: false });

    await reativarRegra(clienteId, regraId);

    const [linha] = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.id, regraId));
    expect(linha.ativa).toBe(true);
    expect(linha.desativadaEm).toBeNull();
  });
});

describe("isolamento entre clientes nas ações (\"Não é bem assim\" e \"Desfazer\")", () => {
  it("desativarRegra recusa mexer numa regra de outro cliente", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const regraDoA = await criarRegra(clienteA, "regra do cliente a");

    await expect(desativarRegra(clienteB, regraDoA)).rejects.toThrow(ErroAprendizado);

    const [linha] = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.id, regraDoA));
    expect(linha.ativa).toBe(true); // continua ativa, o cliente B nao conseguiu mexer
  });

  it("reativarRegra recusa mexer numa regra de outro cliente", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const regraDoA = await criarRegra(clienteA, "regra do cliente a", { ativa: false });

    await expect(reativarRegra(clienteB, regraDoA)).rejects.toThrow(ErroAprendizado);

    const [linha] = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.id, regraDoA));
    expect(linha.ativa).toBe(false); // continua desativada
  });
});

describe("contarReprovacoes (segunda rodada do PR #42, item 3)", () => {
  it("conta reprovacoes, nao a soma de contagem das regras: uma reprovacao com dois motivos conta 1, nao 2", async () => {
    const clienteId = await criarCliente();
    await criarReprovacao(clienteId, ["gancho_fraco", "muito_longo"]);
    await criarRegra(clienteId, "regra a");
    await criarRegra(clienteId, "regra b");

    const total = await contarReprovacoes(clienteId);
    expect(total).toBe(1);

    const regrasAtivas = (await regrasDoCliente(clienteId)).filter((r) => r.ativa).length;
    expect(textosAdmin.clienteDetalhe.aprendizadoQuantos(total, regrasAtivas)).toBe("1 reprovação, 2 regras ativas");
  });

  it("duas reprovacoes distintas contam duas, mesmo que uma regra so some contagem 1", async () => {
    const clienteId = await criarCliente();
    await criarReprovacao(clienteId, ["ja_falei_disso"]);
    await criarReprovacao(clienteId, []);

    expect(await contarReprovacoes(clienteId)).toBe(2);
  });

  it("nunca mistura cliente", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    await criarReprovacao(clienteA, ["gancho_fraco"]);

    expect(await contarReprovacoes(clienteA)).toBe(1);
    expect(await contarReprovacoes(clienteB)).toBe(0);
  });
});

describe("isolamento entre clientes ate o texto do prompt do roteiro (segunda rodada do PR #42, item 8a)", () => {
  it("montarSistemaEstavel com regrasAtivasDoCliente(a) nao contem a regra do cliente b, e o inverso", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    await criarRegra(clienteA, "regra exclusiva do cliente a");
    await criarRegra(clienteB, "regra exclusiva do cliente b");

    const regrasA = await regrasAtivasDoCliente(clienteA);
    const regrasB = await regrasAtivasDoCliente(clienteB);

    const sistemaA = montarSistemaEstavel({
      perfilCompilado: "perfil",
      modeloNicho: "modelo",
      camadaExclusiva: "camada",
      regrasCliente: regrasA,
    });
    const sistemaB = montarSistemaEstavel({
      perfilCompilado: "perfil",
      modeloNicho: "modelo",
      camadaExclusiva: "camada",
      regrasCliente: regrasB,
    });

    expect(sistemaA).toContain("regra exclusiva do cliente a");
    expect(sistemaA).not.toContain("regra exclusiva do cliente b");
    expect(sistemaB).toContain("regra exclusiva do cliente b");
    expect(sistemaB).not.toContain("regra exclusiva do cliente a");
  });
});
