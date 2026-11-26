/**
 * E76 PR 2, contra o Postgres real, em mock: a P12 virou duas (os concorrentes na P12, os perfis admirados na P13, nova). A marca que
 * respondeu a P12 antes da separação não perde nota nem trava: o texto antigo continua na P12, a avaliação dele cobre a P13 na nota
 * até a pessoa editar a P12 ou responder a P13, e o perfil compilado lê esse texto com o enunciado de antes. A marca nova responde
 * as treze, e a avaliação da P12 nova sai com a versão do enunciado.
 */
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ENUNCIADO_P12_ANTES_DA_SEPARACAO, perguntaPorId, perguntasDoBriefing, VERSAO_P12_SEPARADA } from "@/config/briefing";
import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, nichos, user, type AvaliacaoResposta } from "@/db/schema";
import { avaliarResposta, calcularNotaGeral, garantirBriefing, salvarRascunho } from "@/servicos/briefing";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

/** A resposta que o mock avalia com 9 (tamanho, número, fala entre aspas e um nome de lugar). */
function respostaConcreta(id: string): string {
  return `Resposta concreta para ${id}, com o numero 42 na frase, a fala real do cliente "isso resolveu o meu problema", e uma mencao ao bairro de Pinheiros para dar contexto.`;
}

const P12_ANTIGA =
  "Admiro o perfil arrumadeiraprofissional, porque explica bem o passo a passo. Concorrente direto e a Limpa Tudo Express, no mesmo bairro.";

function avaliacao(nota: number): AvaliacaoResposta {
  return { nota, bom: "Tem exemplo.", melhorar: "Poderia trazer mais um caso.", como: "Conte um caso real.", impacto: "O roteiro fica com a sua cara." };
}

async function novaMarca(id: string): Promise<number> {
  await db().insert(user).values({ id, name: `[teste] ${id}`, email: `${id}@p12.teste` });
  const [cliente] = await db().insert(clientes).values({ usuarioId: id, nome: `[teste] ${id}`, nichoId }).returning();
  return cliente.id;
}

/**
 * O briefing como estava antes da E76 PR 2: as doze respondidas e avaliadas (nenhuma avaliação com `versaoPergunta`), a P3 fraca, a
 * nota geral pela conta de antes (doze perguntas, soma dos pesos 16) e ainda abaixo da meta.
 */
async function briefingDeAntes(clienteId: number): Promise<void> {
  const respostas: Record<string, string> = {};
  const avaliacoes: Record<string, AvaliacaoResposta> = {};
  for (let i = 1; i <= 12; i++) {
    const id = `p${i}`;
    respostas[id] = id === "p12" ? P12_ANTIGA : `Resposta de antes para ${id}.`;
    avaliacoes[id] = avaliacao(id === "p3" ? 1 : 8.4);
  }
  // Conta de antes: 15 x 8,4 + 1 x 1 = 127, sobre 16.
  await db().insert(briefings).values({ clienteId, respostas, avaliacoes, notaGeral: "7.94", completo: false });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "p12-separada-teste", nome: "P12 separada teste" }).returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("a marca com a P12 de antes da separação (E76 PR 2)", () => {
  it("a nota de hoje é a mesma de antes, e a P12 continua com o texto antigo", async () => {
    const clienteId = await novaMarca("p12-antes-nota");
    await briefingDeAntes(clienteId);
    const briefing = await garantirBriefing(clienteId);
    expect(calcularNotaGeral(briefing.avaliacoes, "negocio")).toBe(7.94);
    expect(briefing.respostas.p12).toBe(P12_ANTIGA);
    expect(briefing.respostas.p13).toBeUndefined();
  });

  it("não trava: melhorar outra resposta leva à meta sem responder a P13, e a P12 antiga continua cobrindo a P13", async () => {
    const clienteId = await novaMarca("p12-antes-libera");
    await briefingDeAntes(clienteId);

    await salvarRascunho(clienteId, "p3", respostaConcreta("p3"), "negocio");
    const resultado = await avaliarResposta(clienteId, "p3", respostaConcreta("p3"), "negocio");

    // 14 x 8,4 + 9 (a P3) + 0,5 x 8,4 (a P12 antiga) + 0,5 x 8,4 (a P13 coberta) = 135, sobre 16: a mesma conta de antes.
    expect(resultado.avaliacao.nota).toBe(9);
    expect(resultado.notaGeral).toBe(8.44);
    expect(resultado.completo).toBe(true);

    const briefing = await garantirBriefing(clienteId);
    expect(briefing.respostas.p12).toBe(P12_ANTIGA);
    expect(briefing.avaliacoes.p12.versaoPergunta).toBeUndefined();
    expect(briefing.avaliacoes.p13).toBeUndefined();
    expect(briefing.perfil).not.toBeNull();

    // O perfil compilado leu a P12 antiga com o enunciado de antes (os admirados dela não viram concorrentes).
    const [compilacao] = await db()
      .select({ entradas: geracoesIA.entradas })
      .from(geracoesIA)
      .where(and(eq(geracoesIA.tarefa, "compilarPerfil"), eq(geracoesIA.clienteId, clienteId)))
      .orderBy(desc(geracoesIA.id))
      .limit(1);
    const entrada = String(compilacao.entradas.entrada);
    expect(entrada).toContain(`${ENUNCIADO_P12_ANTES_DA_SEPARACAO.negocio}: ${P12_ANTIGA}`);
    expect(entrada).not.toContain(perguntaPorId("p12", "negocio")!.enunciado);
  });

  it("um rascunho na P13, ainda sem avaliar, não derruba a nota", async () => {
    const clienteId = await novaMarca("p12-antes-rascunho-p13");
    await briefingDeAntes(clienteId);
    await salvarRascunho(clienteId, "p13", "Admiro um perfil de limpeza que mostra o antes e depois.", "negocio");
    const briefing = await garantirBriefing(clienteId);
    expect(Number(briefing.notaGeral)).toBe(7.94);
  });

  it("até a pessoa editar: a P12 avaliada de novo sai com a versão e deixa de cobrir a P13, sem fechar o painel já aberto", async () => {
    const clienteId = await novaMarca("p12-antes-edita");
    await briefingDeAntes(clienteId);
    await avaliarResposta(clienteId, "p3", respostaConcreta("p3"), "negocio");

    const novaP12 = respostaConcreta("p12, a Limpa Tudo Express");
    await salvarRascunho(clienteId, "p12", novaP12, "negocio");
    const editada = await avaliarResposta(clienteId, "p12", novaP12, "negocio");

    expect(editada.avaliacao.versaoPergunta).toBe(VERSAO_P12_SEPARADA);
    // 14 x 8,4 + 9 (a P3) + 0,5 x 9 (a P12 nova) + 0,5 x 0 (a P13 sem resposta) = 131,1, sobre 16.
    expect(editada.notaGeral).toBe(8.19);
    expect(editada.completo).toBe(true);

    const comP13 = await avaliarResposta(clienteId, "p13", respostaConcreta("p13"), "negocio");
    // + 0,5 x 9 (a P13): 135,6 sobre 16, 8,475 (o arredondamento em duas casas fica na beira, por isso a comparação aproximada).
    expect(comP13.notaGeral).toBeCloseTo(8.475, 1);
    expect(comP13.notaGeral).toBeGreaterThan(editada.notaGeral);
    expect(comP13.avaliacao.versaoPergunta).toBeUndefined();
  });
});

describe("a marca nova responde as treze (E76 PR 2)", () => {
  it("a P12 sai com a versão do enunciado, a P13 com a dela, e a P12 nova nunca cobre a P13", async () => {
    const clienteId = await novaMarca("p12-nova");
    for (const pergunta of perguntasDoBriefing("negocio")) {
      if (pergunta.id === "p13") continue;
      await avaliarResposta(clienteId, pergunta.id, respostaConcreta(pergunta.id), "negocio");
    }
    const semP13 = await garantirBriefing(clienteId);
    expect(semP13.avaliacoes.p12.versaoPergunta).toBe(VERSAO_P12_SEPARADA);
    // Todas em 9 menos a P13, que conta zero: 15,5 x 9 = 139,5, sobre 16.
    expect(Number(semP13.notaGeral)).toBe(8.72);

    const resultado = await avaliarResposta(clienteId, "p13", respostaConcreta("p13"), "negocio");
    expect(resultado.notaGeral).toBe(9);
  });
});
