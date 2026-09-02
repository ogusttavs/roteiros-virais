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
import { avaliarResposta, garantirBriefing } from "@/servicos/briefing";

import { resetarSchema } from "../../scripts/resetar-schema";

let clienteId: number;
let outroClienteId: number;

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
