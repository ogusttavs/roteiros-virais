/**
 * Fluxo do briefing contra o Postgres real, em mock (etapa 5, criterios de
 * aceite): doze respostas curtas nao liberam, doze concretas liberam e
 * geram o perfil, reavaliar sem mudar o texto reusa a avaliacao guardada, e
 * o briefing de um cliente nunca aparece no de outro.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PERGUNTAS_BRIEFING } from "@/config/briefing";
import { db, getPool } from "@/db";
import { clientes, nichos, user } from "@/db/schema";
import { avaliarResposta, garantirBriefing, salvarRascunho } from "@/servicos/briefing";

import { resetarSchema } from "../../scripts/resetar-schema";

let clienteId: number;
let outroClienteId: number;
let nichoId: number;

function respostaCurta(): string {
  return "atendimento bom";
}

function respostaConcreta(id: string): string {
  return `Resposta concreta para ${id}, com o numero 42 na frase, a fala real do cliente "isso resolveu o meu problema", e uma mencao ao bairro de Pinheiros para dar contexto.`;
}

beforeAll(async () => {
  await resetarSchema(db());

  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "briefing-teste", nome: "Briefing teste" })
    .returning();

  await db()
    .insert(user)
    .values([
      { id: "briefing-a", name: "[teste] Cliente A", email: "a@briefing.teste" },
      { id: "briefing-b", name: "[teste] Cliente B", email: "b@briefing.teste" },
    ]);

  const [clienteA] = await db()
    .insert(clientes)
    .values({ usuarioId: "briefing-a", nome: "[teste] Cliente A", nichoId: nicho.id })
    .returning();
  const [clienteB] = await db()
    .insert(clientes)
    .values({ usuarioId: "briefing-b", nome: "[teste] Cliente B", nichoId: nicho.id })
    .returning();

  clienteId = clienteA.id;
  outroClienteId = clienteB.id;
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("briefing: nota geral e gate de liberacao (mock)", () => {
  it("doze respostas curtas nao chegam ao gate", async () => {
    for (const pergunta of PERGUNTAS_BRIEFING) {
      await avaliarResposta(clienteId, pergunta.id, respostaCurta());
    }

    const briefing = await garantirBriefing(clienteId);
    expect(briefing.completo).toBe(false);
    expect(Number(briefing.notaGeral)).toBeLessThan(8);
    expect(briefing.perfil).toBeNull();
  });

  it("doze respostas concretas liberam e geram o perfil", async () => {
    let ultimoResultado;
    for (const pergunta of PERGUNTAS_BRIEFING) {
      ultimoResultado = await avaliarResposta(clienteId, pergunta.id, respostaConcreta(pergunta.id));
    }

    expect(ultimoResultado?.completo).toBe(true);
    expect(ultimoResultado?.notaGeral).toBeGreaterThanOrEqual(8);

    const briefing = await garantirBriefing(clienteId);
    expect(briefing.completo).toBe(true);
    expect(briefing.perfil).not.toBeNull();
    expect(briefing.perfil?.resumo.length).toBeGreaterThan(0);

    const [cliente] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    expect(cliente?.camadaExclusiva.termos.length).toBeGreaterThan(0);
  });

  it("gate de mao unica: cliente liberado nao fecha o painel se uma edicao derruba a nota geral", async () => {
    const antes = await garantirBriefing(clienteId);
    expect(antes.completo).toBe(true);

    // p1 pesa 2; trocar por uma resposta curta derruba a nota geral para baixo de 8.
    const resultado = await avaliarResposta(clienteId, "p1", respostaCurta());
    expect(resultado.notaGeral).toBeLessThan(8);
    expect(resultado.completo).toBe(true);

    const depois = await garantirBriefing(clienteId);
    expect(depois.completo).toBe(true);
    expect(Number(depois.notaGeral)).toBeLessThan(8);

    // devolve a resposta concreta, para nao atrapalhar os testes seguintes deste arquivo.
    await avaliarResposta(clienteId, "p1", respostaConcreta("p1"));
  });

  it("reavaliar a mesma resposta reusa a avaliacao guardada, sem chamar a IA de novo", async () => {
    const resposta =
      'Resposta unica so deste teste, com o numero 7 na frase e a fala "isso e novidade", mencionando o bairro de Realengo.';

    const primeira = await avaliarResposta(clienteId, "p3", resposta);
    expect(primeira.reusada).toBe(false);

    const segunda = await avaliarResposta(clienteId, "p3", resposta);
    expect(segunda.reusada).toBe(true);
    expect(segunda.avaliacao).toEqual(primeira.avaliacao);
  });
});

describe("briefing: isolamento entre clientes", () => {
  it("o briefing de um cliente nao aparece no de outro", async () => {
    const briefingOutro = await garantirBriefing(outroClienteId);
    expect(briefingOutro.respostas.p1).toBeUndefined();
    expect(briefingOutro.completo).toBe(false);
    expect(briefingOutro.perfil).toBeNull();
  });
});

describe("briefing: escrita atomica (revisao da parte 1)", () => {
  it("duas avaliacoes em paralelo, em perguntas diferentes, gravam as duas", async () => {
    const [usuario] = await db()
      .insert(user)
      .values({ id: "briefing-concorrencia", name: "[teste] Concorrencia", email: "concorrencia@briefing.teste" })
      .returning();
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: usuario.id, nome: "[teste] Concorrencia", nichoId })
      .returning();

    await Promise.all([
      avaliarResposta(cliente.id, "p1", respostaConcreta("p1")),
      avaliarResposta(cliente.id, "p2", respostaConcreta("p2")),
    ]);

    const briefing = await garantirBriefing(cliente.id);
    expect(briefing.respostas.p1).toBeDefined();
    expect(briefing.respostas.p2).toBeDefined();
    expect(briefing.avaliacoes.p1).toBeDefined();
    expect(briefing.avaliacoes.p2).toBeDefined();
  });

  it("rascunho com texto diferente do avaliado invalida a avaliacao guardada, para nao reusar nota errada", async () => {
    const [usuario] = await db()
      .insert(user)
      .values({ id: "briefing-rascunho-invalida", name: "[teste] Invalida", email: "invalida@briefing.teste" })
      .returning();
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: usuario.id, nome: "[teste] Invalida", nichoId })
      .returning();

    const primeira = await avaliarResposta(cliente.id, "p1", respostaConcreta("p1"));
    expect(primeira.reusada).toBe(false);

    // rascunho troca o texto sem passar por avaliarResposta (o que a tela faz a cada 800ms de digitacao).
    await salvarRascunho(cliente.id, "p1", "bom atendimento");

    const depoisDoRascunho = await garantirBriefing(cliente.id);
    expect(depoisDoRascunho.respostas.p1).toBe("bom atendimento");
    expect(depoisDoRascunho.avaliacoes.p1).toBeUndefined();

    // avaliar o texto novo nao pode reusar a avaliacao da resposta concreta anterior.
    const segunda = await avaliarResposta(cliente.id, "p1", "bom atendimento");
    expect(segunda.reusada).toBe(false);
    expect(segunda.avaliacao).not.toEqual(primeira.avaliacao);
  });

  it("rascunho com o mesmo texto ja avaliado nao apaga a avaliacao guardada", async () => {
    const [usuario] = await db()
      .insert(user)
      .values({ id: "briefing-rascunho-mesmo-texto", name: "[teste] Mesmo texto", email: "mesmotexto@briefing.teste" })
      .returning();
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: usuario.id, nome: "[teste] Mesmo texto", nichoId })
      .returning();

    const resposta = respostaConcreta("p1");
    const primeira = await avaliarResposta(cliente.id, "p1", resposta);

    await salvarRascunho(cliente.id, "p1", resposta);

    const briefing = await garantirBriefing(cliente.id);
    expect(briefing.avaliacoes.p1).toEqual(primeira.avaliacao);
  });

  it("salvarRascunho em paralelo, em perguntas diferentes, grava as duas", async () => {
    const [usuario] = await db()
      .insert(user)
      .values({ id: "briefing-concorrencia-rascunho", name: "[teste] Rascunho", email: "rascunho@briefing.teste" })
      .returning();
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: usuario.id, nome: "[teste] Rascunho", nichoId })
      .returning();

    await Promise.all([
      salvarRascunho(cliente.id, "p1", "rascunho da p1"),
      salvarRascunho(cliente.id, "p2", "rascunho da p2"),
    ]);

    const briefing = await garantirBriefing(cliente.id);
    expect(briefing.respostas.p1).toBe("rascunho da p1");
    expect(briefing.respostas.p2).toBe("rascunho da p2");
  });
});
