/**
 * `ultimaGeracaoReprovadaDuasVezes` (V10, item 2, `admin-acompanhamento.ts`):
 * arquivo próprio, isolado, porque a consulta olha `geracoes_ia` inteira,
 * sem filtro de nicho nem cliente (pega a última reprovação dupla, não a de
 * uma marca). Precisa de controle fino sobre a ORDEM de inserção (o `id`
 * crescente é o que o `lag()` usa), então nada de dado de outro teste
 * competindo pela linha "mais recente".
 *
 * Achado da revisão: duas linhas adjacentes da mesma tarefa e do mesmo
 * cliente com motivo preenchido não bastam para provar "a mesma invocação
 * reprovou duas vezes" (`avaliarResposta` do briefing chama
 * `gerarComVerificacao` uma vez por pergunta, sempre com a mesma tarefa e o
 * mesmo cliente). Por isso os testes daqui reproduzem o texto real que
 * `gerarComVerificacao` grava na entrada da segunda tentativa
 * (`MARCADOR_SEGUNDA_TENTATIVA`), nunca `entradas: {}` vazio.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, geracoesIA, nichos, user } from "@/db/schema";
import { MARCADOR_SEGUNDA_TENTATIVA } from "@/ia/verificador";
import { ultimaGeracaoReprovadaDuasVezes } from "@/servicos/admin-acompanhamento";

import { resetarSchema } from "../../scripts/resetar-schema";

let clienteId: number;

/** `entrada` no formato de uma primeira tentativa qualquer, sem o marcador. */
function entradaPrimeiraTentativa(): string {
  return "entrada de exemplo";
}

/** O mesmo texto que `gerarComVerificacao` (ia/verificador.ts) monta para a segunda tentativa de verdade. */
function entradaSegundaTentativa(motivoAnterior: string): string {
  return `entrada de exemplo\n\n${MARCADOR_SEGUNDA_TENTATIVA} Motivo: ${motivoAnterior}. Corrija isso.`;
}

async function inserirGeracao(tarefa: string, entrada: string, motivoAvaliacao: string | null): Promise<void> {
  await db()
    .insert(geracoesIA)
    .values({
      tarefa,
      versaoPrompt: "1.0.0",
      modelo: "mock",
      clienteId,
      entradas: { entrada },
      motivoAvaliacao: motivoAvaliacao ?? undefined,
    });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "acomp-geracao-teste", nome: "Acomp geracao teste", termos: [] }).returning();
  await db().insert(user).values({ id: "acomp-geracao-user", name: "[teste]", email: "acomp-geracao@teste.invalido" });
  const [cliente] = await db().insert(clientes).values({ usuarioId: "acomp-geracao-user", nome: "[teste] Marca", nichoId: nicho.id }).returning();
  clienteId = cliente.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("ultimaGeracaoReprovadaDuasVezes", () => {
  it("aprovado, depois reprovado uma vez so: nao conta (o retry ainda pode aprovar)", async () => {
    await inserirGeracao("roteiro-caso-1", entradaPrimeiraTentativa(), null);
    await inserirGeracao("roteiro-caso-1", entradaSegundaTentativa("jargao"), "jargao");
    const resultado = await ultimaGeracaoReprovadaDuasVezes();
    expect(resultado?.tarefa).not.toBe("roteiro-caso-1");
  });

  it("reprovado duas vezes seguidas, a segunda tentativa com o marcador: acha a segunda tentativa, com o motivo dela", async () => {
    await inserirGeracao("roteiro-caso-2", entradaPrimeiraTentativa(), "motivo da primeira tentativa");
    await inserirGeracao("roteiro-caso-2", entradaSegundaTentativa("motivo da primeira tentativa"), "motivo da segunda tentativa");

    const resultado = await ultimaGeracaoReprovadaDuasVezes();
    expect(resultado).toEqual({
      tarefa: "roteiro-caso-2",
      clienteId,
      motivo: "motivo da segunda tentativa",
      quando: expect.any(Date),
    });
  });

  it("reprovado duas vezes e so depois aprovado: o evento de duas reprovacoes seguidas continua valendo (aconteceu, o retry seguinte nao apaga isso)", async () => {
    await inserirGeracao("roteiro-caso-3", entradaPrimeiraTentativa(), "motivo 1");
    await inserirGeracao("roteiro-caso-3", entradaSegundaTentativa("motivo 1"), "motivo 2");
    await inserirGeracao("roteiro-caso-3", entradaPrimeiraTentativa(), null);

    const resultado = await ultimaGeracaoReprovadaDuasVezes();
    expect(resultado?.tarefa).toBe("roteiro-caso-3");
    expect(resultado?.motivo).toBe("motivo 2");
  });

  // Achado da revisão adversarial: duas invocações diferentes, mesma tarefa e mesmo cliente
  // (o caso real de avaliarResposta, uma pergunta atrás da outra no briefing), cada uma com a
  // própria primeira tentativa reprovada, NUNCA podem ser lidas como "a mesma reprovou duas
  // vezes", mesmo ficando lado a lado em geracoes_ia.
  it("duas invocacoes diferentes da mesma tarefa e do mesmo cliente, cada uma reprovada so uma vez: nunca mistura o motivo de uma com a outra", async () => {
    // Invocacao A: reprovou de verdade duas vezes (primeira e segunda, com o marcador). Esta e a
    // reprovacao dupla de verdade, a que a consulta precisa achar.
    await inserirGeracao("avaliarResposta", entradaPrimeiraTentativa(), "motivo da pergunta A, tentativa 1");
    await inserirGeracao("avaliarResposta", entradaSegundaTentativa("motivo da pergunta A, tentativa 1"), "motivo da pergunta A, tentativa 2");
    // Invocacao B: uma pergunta diferente, mesma tarefa e mesmo cliente, logo depois de A na
    // tabela; a primeira tentativa dela tambem reprova (sem o marcador, porque e uma invocacao
    // nova, nao a segunda tentativa de A) e o retry dela nem chega a rodar neste teste. Antes da
    // correcao, isso fazia a consulta devolver o motivo de B como se fosse a segunda tentativa
    // de A, so por estarem lado a lado em geracoes_ia.
    await inserirGeracao("avaliarResposta", entradaPrimeiraTentativa(), "motivo da pergunta B, tentativa 1");

    const resultado = await ultimaGeracaoReprovadaDuasVezes();
    // A reprovacao dupla de verdade e a de A; o motivo tem que ser o da segunda tentativa dela,
    // nunca o motivo isolado (e nao relacionado) da primeira tentativa de B.
    expect(resultado?.tarefa).toBe("avaliarResposta");
    expect(resultado?.motivo).toBe("motivo da pergunta A, tentativa 2");
  });
});
