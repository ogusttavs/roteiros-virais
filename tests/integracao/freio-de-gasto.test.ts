/**
 * O freio de gasto da IA por marca (achado A4 da auditoria de segurança de 26/11/2026), contra o Postgres real, com o simulador da IA e o relógio simulado (só `Date`; o `pg` precisa dos
 * temporizadores de verdade): o que conta em cada janela, a recusa pela hora (que vale até para a cortesia e o plano sem limite), a recusa pelo dia (que não vale para elas), a volta quando
 * a janela passa, a chave que desliga, a busca na web e as leituras do momento e da agenda freadas do mesmo jeito, a chamada sem marca sem freio e o e-mail do alarme da IA uma vez por dia por marca.
 */
import { eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { db, getPool } from "@/db";
import { clientes, configuracaoAdmin, geracoesIA, user } from "@/db/schema";
import { buscarNaWeb } from "@/ia/busca-na-web";
import { gerarEstruturado } from "@/ia/cliente";
import { ErroFreioDeGasto, gastoRecenteDaMarca } from "@/ia/freio";
import { avisarFreioDeGasto, chaveDoAvisoDoFreio } from "@/servicos/aviso-da-ia";
import { lerMomentoDeTexto } from "@/servicos/momento";
import { lerAgendaDeTexto } from "@/servicos/plano";
import { textosFreioDaIA } from "@/textos/freio-ia";

import { resetarSchema } from "../../scripts/resetar-schema";

const AGORA = new Date("2026-11-26T15:00:00.000Z");
const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
/** O simulador devolve o roteiro de exemplo; um objeto sem campos exigidos aceita qualquer saída (o teste é do freio, não do roteiro). */
const SCHEMA = z.object({});

let comum: number;
let outra: number;
let cortesia: number;
let semLimite: number;

async function gastou(clienteId: number, custoUsd: number, haMs: number) {
  await db()
    .insert(geracoesIA)
    .values({ tarefa: "roteiro", versaoPrompt: "1", modelo: "mock", clienteId, entradas: {}, custoUsd: custoUsd.toFixed(6), criadoEm: new Date(AGORA.getTime() - haMs) });
}

function gerar(clienteId: number | undefined) {
  return gerarEstruturado({ tarefa: "roteiro", nivel: "forte", schema: SCHEMA, sistemaEstavel: "s", entrada: "o freio", clienteId });
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  await resetarSchema(db());
  const marca = async (nome: string, extra: Partial<typeof clientes.$inferInsert> = {}) => (await db().insert(clientes).values({ nome, ...extra }).returning())[0].id;
  comum = await marca("[teste] Comum");
  outra = await marca("[teste] Outra");
  cortesia = await marca("[teste] Cortesia", { cortesia: true });
  semLimite = await marca("[teste] Sem limite", { plano: "sem_limite" });
}, 60_000);

beforeEach(async () => {
  vi.setSystemTime(AGORA);
  await db().delete(geracoesIA);
  await db().delete(configuracaoAdmin).where(like(configuracaoAdmin.chave, "aviso_ia_freio_%"));
  await db().delete(user);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  vi.useRealTimers();
  await getPool().end();
});

describe("o que conta em cada janela", () => {
  it("soma só a marca, a última hora e as últimas 24 horas, e nada depois de agora", async () => {
    await gastou(comum, 3, 30 * MINUTO);
    await gastou(comum, 10, 2 * HORA);
    await gastou(comum, 100, 25 * HORA);
    await gastou(comum, 50, -10 * MINUTO);
    await gastou(outra, 100, 5 * MINUTO);

    expect(await gastoRecenteDaMarca(comum, AGORA)).toEqual({ nome: "[teste] Comum", hora: 3, dia: 13, semTetoDoDia: false });
    expect(await gastoRecenteDaMarca(cortesia, AGORA)).toMatchObject({ hora: 0, dia: 0, semTetoDoDia: true });
    expect(await gastoRecenteDaMarca(semLimite, AGORA)).toMatchObject({ semTetoDoDia: true });
    expect(await gastoRecenteDaMarca(999_999, AGORA)).toBeNull();
  });
});

describe("a recusa", () => {
  it("pela hora: a marca acima de US$ 8 na última hora é recusada com a frase própria, a outra marca segue, e passada a hora volta", async () => {
    await gastou(comum, 5, 10 * MINUTO);
    await gastou(comum, 3.5, 50 * MINUTO);

    const erro = await gerar(comum).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroFreioDeGasto);
    expect((erro as ErroFreioDeGasto).janela).toBe("hora");
    expect((erro as ErroFreioDeGasto).mensagemCliente).toBe(textosFreioDaIA.cliente.hora);
    expect((erro as ErroFreioDeGasto).causa).toBeNull();
    await expect(gerar(outra)).resolves.toMatchObject({ modelo: expect.any(String) });

    // Onze minutos depois, os US$ 3,50 de 50 minutos atrás saem da janela: sobram US$ 5.
    vi.setSystemTime(new Date(AGORA.getTime() + 11 * MINUTO));
    await expect(gerar(comum)).resolves.toBeDefined();
  });

  it("pela hora, também para a cortesia e para o plano sem limite", async () => {
    await gastou(cortesia, 9, 5 * MINUTO);
    await gastou(semLimite, 9, 5 * MINUTO);
    await expect(gerar(cortesia)).rejects.toMatchObject({ janela: "hora" });
    await expect(gerar(semLimite)).rejects.toMatchObject({ janela: "hora" });
  });

  it("pelo dia: a marca comum acima de US$ 25 em 24 horas é recusada; a de cortesia e a sem limite, com o mesmo gasto, não; no dia seguinte volta", async () => {
    for (const marca of [comum, cortesia, semLimite]) {
      for (const horas of [3, 6, 9, 12]) await gastou(marca, 6.5, horas * HORA);
    }

    const erro = await gerar(comum).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroFreioDeGasto);
    expect((erro as ErroFreioDeGasto).janela).toBe("dia");
    expect((erro as ErroFreioDeGasto).mensagemCliente).toBe(textosFreioDaIA.cliente.dia);
    await expect(gerar(cortesia)).resolves.toBeDefined();
    await expect(gerar(semLimite)).resolves.toBeDefined();

    vi.setSystemTime(new Date(AGORA.getTime() + 13 * HORA));
    await expect(gerar(comum)).resolves.toBeDefined();
  });

  it("pelo dia da cortesia: a de cortesia e a sem limite acima de US$ 60 em 24 horas são recusadas com a mesma frase do dia; a comum com o mesmo gasto também (pelo teto comum)", async () => {
    for (const marca of [cortesia, semLimite]) {
      for (const horas of [3, 6, 9, 12]) await gastou(marca, 15.5, horas * HORA);
    }
    for (const marca of [cortesia, semLimite]) {
      const erro = await gerar(marca).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroFreioDeGasto);
      expect((erro as ErroFreioDeGasto).janela).toBe("dia_cortesia");
      expect((erro as ErroFreioDeGasto).mensagemCliente).toBe(textosFreioDaIA.cliente.dia);
    }
    vi.stubEnv("FREIO_IA_POR_DIA_CORTESIA_USD", "100");
    await expect(gerar(cortesia)).resolves.toBeDefined();
  });

  it("os limites vêm do ambiente, e FREIO_IA=0 desliga o freio", async () => {
    await gastou(comum, 3, 5 * MINUTO);
    vi.stubEnv("FREIO_IA_POR_HORA_USD", "2");
    await expect(gerar(comum)).rejects.toMatchObject({ janela: "hora" });
    vi.stubEnv("FREIO_IA", "0");
    await expect(gerar(comum)).resolves.toBeDefined();
  });

  it("a chamada sem marca (tarefa do setor ou do sistema) não passa pelo freio", async () => {
    await gastou(comum, 100, 5 * MINUTO);
    await expect(gerar(undefined)).resolves.toBeDefined();
  });

  it("a leitura do momento e a da agenda, que antes não levavam marca, são freadas com ela", async () => {
    await gastou(comum, 9, 5 * MINUTO);
    await expect(lerMomentoDeTexto("estou na loja com o sabão novo", comum)).rejects.toBeInstanceOf(ErroFreioDeGasto);
    await expect(lerAgendaDeTexto("segunda: feira", "2026-11-26", comum)).rejects.toBeInstanceOf(ErroFreioDeGasto);
    await expect(lerMomentoDeTexto("estou na loja com o sabão novo", outra)).resolves.toBeDefined();
    await expect(lerAgendaDeTexto("segunda: feira", "2026-11-26", outra)).resolves.toBeDefined();
  });

  it("a busca na web da marca é freada do mesmo jeito", async () => {
    await gastou(comum, 9, 5 * MINUTO);
    const busca = { sistemaEstavel: "s", entrada: "o preço do sabão", maxBuscas: 3, dominios: ["gov.br"] };
    await expect(buscarNaWeb({ ...busca, clienteId: comum })).rejects.toBeInstanceOf(ErroFreioDeGasto);
    await expect(buscarNaWeb({ ...busca, clienteId: outra })).resolves.toBeDefined();
  });
});

describe("o alarme da IA", () => {
  async function criarAdmin() {
    await db().insert(user).values({ id: "freio-admin", name: "Dono", email: "dono@freio.teste", role: "admin" });
  }

  it("a recusa anota o aviso do dia da marca (o e-mail sai pelo simulador)", async () => {
    await criarAdmin();
    await gastou(comum, 9, 5 * MINUTO);
    await expect(gerar(comum)).rejects.toBeInstanceOf(ErroFreioDeGasto);
    const [linha] = await db().select({ valor: configuracaoAdmin.valor }).from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, chaveDoAvisoDoFreio(comum)));
    expect(linha?.valor).toBe("2026-11-26");
  });

  it("um e-mail por dia por marca: a segunda recusa do dia não manda, outra marca manda, no dia seguinte manda de novo; o nome da marca vai escapado", async () => {
    await criarAdmin();
    const enviar = vi.fn().mockResolvedValue(undefined);
    const freio = { clienteId: comum, nome: "<b>Comum</b>", tarefa: "roteiro", janela: "hora" as const, gastoUsd: 9.2, limiteUsd: 8, em: AGORA };

    expect(await avisarFreioDeGasto(freio, AGORA, enviar)).toEqual({ enviado: true, destinatarios: 1 });
    const { para, assunto, html } = enviar.mock.calls[0][0] as { para: string; assunto: string; html: string };
    expect(para).toBe("dono@freio.teste");
    expect(assunto).toContain("passou do limite de gasto da IA");
    expect(html).toContain("&lt;b&gt;Comum&lt;/b&gt;");
    expect(html).toContain("US$ 9,20");
    expect(html).toContain("FREIO_IA_POR_HORA_USD");
    expect(html).toContain(`/admin/clientes/${comum}`);

    expect(await avisarFreioDeGasto(freio, AGORA, enviar)).toEqual({ enviado: false, motivo: "ja enviado hoje" });
    expect(await avisarFreioDeGasto({ ...freio, clienteId: outra }, AGORA, enviar)).toMatchObject({ enviado: true });
    expect(await avisarFreioDeGasto(freio, new Date(AGORA.getTime() + 24 * HORA), enviar)).toMatchObject({ enviado: true });
    expect(enviar).toHaveBeenCalledTimes(3);
  });
});
