/**
 * O alarme da IA (achados B1 e A1 da revisão de 23/11/2026), contra o Postgres real e com o simulador: o dono recebe no máximo um e-mail por dia por causa (chave recusada ou falta de crédito, nunca a
 * sobrecarga), a trava aguenta falhas ao mesmo tempo, o e-mail sai do ponto que anota a falha, a avaliação do briefing devolve a frase certa, e o pedido dos temas para quando a IA está trancada e volta
 * quando uma geração dá certo.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { db, getPool } from "@/db";
import { configuracaoAdmin, geracoesIA, nichos, temasDia, user } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { CHAVES_DAS_FALHAS_DA_IA, registrarFalhaDaIA } from "@/ia/falha-da-ia";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { comoResultadoDaIA } from "@/lib/resultado-da-ia";
import { avisarFalhaDaIA, chaveDoAvisoDaIA } from "@/servicos/aviso-da-ia";
import { pedirTemaDeHoje, pedirTemasDaConta } from "@/servicos/temas";

import { resetarSchema } from "../../scripts/resetar-schema";

const EM = new Date("2026-11-23T15:00:00.000Z");
const DIA_SEGUINTE = new Date("2026-11-24T15:00:00.000Z");
const falhaChave = { causa: "chave", tarefa: "briefing", em: EM } as const;
const falhaCredito = { causa: "credito", tarefa: "roteiro", em: EM } as const;
const SCHEMA = z.object({ ok: z.boolean() });
let nichoId: number;

async function chamar(marcador: string): Promise<unknown> {
  return gerarEstruturado({ tarefa: "roteiro", nivel: "forte", schema: SCHEMA, sistemaEstavel: "s", entrada: `o momento ${marcador}` }).catch((e: unknown) => e);
}

async function boaGeracaoDepois() {
  await db().insert(geracoesIA).values({ tarefa: "roteiro", versaoPrompt: "1", modelo: "mock", entradas: {}, saida: { ok: true }, criadoEm: new Date(Date.now() + 5_000) });
}

async function pendentesDosTemas() {
  const r = await db().execute(sql`select 1 from pgboss.job where name = ${FILAS.temasDoDia} and (data ->> 'nichoId')::int = ${nichoId} and state in ('created', 'retry', 'active')`);
  return r.rows.length;
}

beforeAll(async () => {
  await resetarSchema(db());
  nichoId = (await db().insert(nichos).values({ slug: "alarme-ia", nome: "alarme-ia", termos: [] }).returning())[0].id;
}, 60_000);

beforeEach(async () => {
  await db()
    .delete(configuracaoAdmin)
    .where(inArray(configuracaoAdmin.chave, [...CHAVES_DAS_FALHAS_DA_IA, chaveDoAvisoDaIA("chave"), chaveDoAvisoDaIA("credito")]));
  await db().delete(geracoesIA);
  await db().delete(user);
  await db().delete(temasDia);
  await garantirBossPronto();
  await boss().deleteAllJobs(FILAS.temasDoDia).catch(() => undefined);
});

afterAll(async () => {
  await boss().deleteAllJobs(FILAS.temasDoDia).catch(() => undefined);
  await boss().stop({ graceful: false, timeout: 1 }).catch(() => undefined);
  await getPool().end();
});

async function criarAdmin(email = "dono@alarme.teste", extra: { banido?: boolean; papel?: string } = {}) {
  await db().insert(user).values({ id: `alarme-${email}`, name: "Dono", email, role: extra.papel ?? "admin", banned: extra.banido ?? false });
}

describe("o e-mail ao dono, no máximo um por dia por causa", () => {
  it("manda um e-mail por admin (sem cliente nem banido), diz a causa, e o segundo aviso do mesmo dia não sai", async () => {
    await criarAdmin();
    await criarAdmin("outro@alarme.teste");
    await criarAdmin("cliente@alarme.teste", { papel: "cliente" });
    await criarAdmin("banido@alarme.teste", { banido: true });
    const enviar = vi.fn().mockResolvedValue(undefined);

    const primeiro = await avisarFalhaDaIA(falhaChave, EM, enviar);
    expect(primeiro).toEqual({ enviado: true, destinatarios: 2 });
    expect(enviar).toHaveBeenCalledTimes(2);
    const { para, assunto, html } = enviar.mock.calls[0][0] as { para: string; assunto: string; html: string };
    expect(["dono@alarme.teste", "outro@alarme.teste"]).toContain(para);
    expect(assunto).toBe("A chave da IA foi recusada");
    expect(html).toContain("ANTHROPIC_API_KEY");
    expect(html).not.toMatch(/[—–]/);

    const segundo = await avisarFalhaDaIA(falhaChave, new Date(EM.getTime() + 3 * 3600_000), enviar);
    expect(segundo).toEqual({ enviado: false, motivo: "ja enviado hoje" });
    expect(enviar).toHaveBeenCalledTimes(2);
  });

  it("no dia seguinte, com a falha ainda valendo, avisa de novo", async () => {
    await criarAdmin();
    const enviar = vi.fn().mockResolvedValue(undefined);
    await avisarFalhaDaIA(falhaChave, EM, enviar);
    expect((await avisarFalhaDaIA(falhaChave, DIA_SEGUINTE, enviar)).enviado).toBe(true);
    expect(enviar).toHaveBeenCalledTimes(2);
  });

  it("cada causa tem a sua trava: o crédito não é calado pelo aviso da chave", async () => {
    await criarAdmin();
    const enviar = vi.fn().mockResolvedValue(undefined);
    await avisarFalhaDaIA(falhaChave, EM, enviar);
    const credito = await avisarFalhaDaIA(falhaCredito, EM, enviar);
    expect(credito.enviado).toBe(true);
    expect(enviar.mock.calls[1][0].assunto).toBe("A IA está sem crédito");
  });

  it("falhas ao mesmo tempo (os temas de vários setores falham juntos) disputam a trava e só um aviso sai", async () => {
    await criarAdmin();
    const enviar = vi.fn().mockResolvedValue(undefined);
    const resultados = await Promise.all(Array.from({ length: 8 }, () => avisarFalhaDaIA(falhaChave, EM, enviar)));
    expect(resultados.filter((r) => r.enviado)).toHaveLength(1);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("sem nenhum envio que dê certo, a trava volta e a próxima falha tenta de novo", async () => {
    await criarAdmin();
    const falhando = vi.fn().mockRejectedValue(new Error("resend fora do ar"));
    expect(await avisarFalhaDaIA(falhaChave, EM, falhando)).toEqual({ enviado: false, motivo: "falha no envio", destinatarios: 0 });
    const funcionando = vi.fn().mockResolvedValue(undefined);
    expect((await avisarFalhaDaIA(falhaChave, EM, funcionando)).enviado).toBe(true);
  });

  it("sem admin nem EMAIL_ACOMPANHAMENTO não manda e não gasta a trava do dia", async () => {
    const enviar = vi.fn().mockResolvedValue(undefined);
    expect(await avisarFalhaDaIA(falhaChave, EM, enviar)).toEqual({ enviado: false, motivo: "sem destinatario" });
    await criarAdmin();
    expect((await avisarFalhaDaIA(falhaChave, EM, enviar)).enviado).toBe(true);
  });
});

describe("o gatilho: o ponto que anota a falha", () => {
  async function travaDoDia(causa: "chave" | "credito") {
    const [l] = await db().select({ valor: configuracaoAdmin.valor }).from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, chaveDoAvisoDaIA(causa)));
    return l?.valor ?? null;
  }

  it.each([
    ["[mock:erro-chave]", "chave"],
    ["[mock:erro-credito]", "credito"],
  ] as const)("uma geração que falha com %s avisa o dono (a trava do dia fica gravada)", async (marcador, causa) => {
    await criarAdmin();
    expect(await travaDoDia(causa)).toBeNull();
    await chamar(marcador);
    expect(await travaDoDia(causa)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("a sobrecarga é passageira: anota a falha, mas não avisa ninguém", async () => {
    await criarAdmin();
    await chamar("[mock:erro-sobrecarga]");
    await registrarFalhaDaIA("sobrecarga", "roteiro", EM);
    expect(await travaDoDia("chave")).toBeNull();
    expect(await travaDoDia("credito")).toBeNull();
  });

  it("o e-mail não muda o erro que sobe", async () => {
    await criarAdmin();
    const erro = await chamar("[mock:erro-chave]");
    expect((erro as Error).name).toBe("ErroIA");
  });
});

describe("a avaliação do briefing devolve a verdade", () => {
  it("chave recusada vira a frase do problema nosso como resultado (não uma exceção que o Next esconde)", async () => {
    const r = await comoResultadoDaIA(async () => {
      throw (await chamar("[mock:erro-chave]")) as Error;
    });
    expect(r).toEqual({ ok: false, erro: "Estamos com um problema do nosso lado e já fomos avisados. Volte mais tarde." });
  });

  it("falta de crédito também", async () => {
    const r = await comoResultadoDaIA(async () => {
      throw (await chamar("[mock:erro-credito]")) as Error;
    });
    expect(r.ok).toBe(false);
  });

  it("a sobrecarga continua lançada (a tela diz que não deu para avaliar agora), e o sucesso passa direto", async () => {
    const sobrecarga = (await chamar("[mock:erro-sobrecarga]")) as Error;
    await expect(
      comoResultadoDaIA(async () => {
        throw sobrecarga;
      }),
    ).rejects.toBe(sobrecarga);
    expect(await comoResultadoDaIA(async () => 42)).toEqual({ ok: true, dado: 42 });
  });
});

describe("o ciclo dos temas para e volta", () => {
  it("com a chave recusada o pedido não sai (nada na fila); quando uma geração dá certo depois, volta a pedir sozinho", async () => {
    await chamar("[mock:erro-chave]");
    expect(await pedirTemaDeHoje(nichoId)).toBe("nao");
    expect(await pedirTemaDeHoje(nichoId)).toBe("nao");
    expect(await pedirTemasDaConta(1, nichoId, "foco")).toBe("nao");
    expect(await pendentesDosTemas()).toBe(0);

    await boaGeracaoDepois();
    expect(await pedirTemaDeHoje(nichoId)).toBe("gerando");
    expect(await pendentesDosTemas()).toBe(1);
  });

  it("a sobrecarga não para o pedido: ela passa sozinha", async () => {
    await chamar("[mock:erro-sobrecarga]");
    expect(await pedirTemaDeHoje(nichoId)).toBe("gerando");
  });

  it("a falta de crédito também para o pedido", async () => {
    await chamar("[mock:erro-credito]");
    expect(await pedirTemaDeHoje(nichoId)).toBe("nao");
    expect(await pendentesDosTemas()).toBe(0);
  });
});
