/**
 * A falha da API da IA com causa conhecida (achado de 05/10/2026), contra o Postgres real e com o simulador: a chamada que o simulador recusa pelo marcador leva a causa e fica anotada; a falta
 * de crédito vira aviso no Início do admin e some sozinha quando uma geração dá certo depois; sobrecarga e chave ficam anotadas mas não viram aviso; a anotação nunca muda o erro que sobe.
 */
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { db, getPool } from "@/db";
import { configuracaoAdmin, geracoesIA } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { ErroIA } from "@/ia/erro";
import { CHAVES_DAS_FALHAS_DA_IA, chaveDaFalhaDaIA, faltaDeCreditoDaIA, lerFalhaDaIA, registrarFalhaDaIA } from "@/ia/falha-da-ia";
import { inicioDoAdmin } from "@/servicos/admin-inicio";

import { resetarSchema } from "../../scripts/resetar-schema";

const SCHEMA = z.object({ ok: z.boolean() });

async function chamar(marcador: string): Promise<unknown> {
  return gerarEstruturado({ tarefa: "roteiro", nivel: "forte", schema: SCHEMA, sistemaEstavel: "sistema", entrada: `o momento que a pessoa contou ${marcador}` }).catch((e: unknown) => e);
}

async function falhaAnotada(causa: "credito" | "sobrecarga" | "chave") {
  const [linha] = await db().select({ valor: configuracaoAdmin.valor }).from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, chaveDaFalhaDaIA(causa)));
  return lerFalhaDaIA(linha?.valor);
}

beforeAll(async () => {
  await resetarSchema(db());
}, 60_000);

beforeEach(async () => {
  await db().delete(configuracaoAdmin).where(inArray(configuracaoAdmin.chave, CHAVES_DAS_FALHAS_DA_IA));
  await db().delete(geracoesIA);
});

afterAll(async () => {
  await getPool().end();
});

describe("a chamada que a IA recusa pela causa", () => {
  it.each([
    ["[mock:erro-credito]", "credito"],
    ["[mock:erro-sobrecarga]", "sobrecarga"],
    ["[mock:erro-chave]", "chave"],
  ] as const)("%s sobe um ErroIA com a causa %s, e a causa fica anotada com a tarefa", async (marcador, causa) => {
    const erro = await chamar(marcador);
    expect(erro).toBeInstanceOf(ErroIA);
    expect((erro as ErroIA).causa).toBe(causa);
    // a frase para o cliente continua a genérica
    expect((erro as ErroIA).mensagemCliente).toBe("Não conseguimos fazer isso agora. Tente de novo em um minuto.");
    const anotada = await falhaAnotada(causa);
    expect(anotada?.causa).toBe(causa);
    expect(anotada?.tarefa).toBe("roteiro");
  });

  it("uma chamada sem marcador não anota nada", async () => {
    const r = await gerarEstruturado({ tarefa: "roteiro", nivel: "forte", schema: z.any(), sistemaEstavel: "s", entrada: "um momento qualquer" }).catch((e: unknown) => e);
    expect(r instanceof ErroIA && r.causa).toBeFalsy();
    for (const causa of ["credito", "sobrecarga", "chave"] as const) expect(await falhaAnotada(causa)).toBeNull();
  });

  it("uma sobrecarga ou uma chave recusada mais nova não apaga a falta de crédito que ainda vale", async () => {
    await chamar("[mock:erro-credito]");
    await chamar("[mock:erro-sobrecarga]");
    await chamar("[mock:erro-chave]");
    expect((await falhaAnotada("credito"))?.causa).toBe("credito");
    expect((await faltaDeCreditoDaIA())?.causa).toBe("credito");
  });
});

describe("a falta de crédito como aviso", () => {
  it("vale depois da falha e some quando uma geração dá certo depois dela", async () => {
    expect(await faltaDeCreditoDaIA()).toBeNull();
    await chamar("[mock:erro-credito]");
    expect((await faltaDeCreditoDaIA())?.causa).toBe("credito");

    // uma geração boa ANTES da falha não apaga
    await db().insert(geracoesIA).values({ tarefa: "roteiro", versaoPrompt: "1", modelo: "mock", entradas: {}, criadoEm: new Date(Date.now() - 60_000) });
    expect((await faltaDeCreditoDaIA())?.causa).toBe("credito");

    // uma DEPOIS apaga
    await db().insert(geracoesIA).values({ tarefa: "roteiro", versaoPrompt: "1", modelo: "mock", entradas: {}, criadoEm: new Date(Date.now() + 5_000) });
    expect(await faltaDeCreditoDaIA()).toBeNull();
  });

  it("a linha de uma geração que terminou em erro não prova que o crédito voltou (a pesquisa que cai depois de gastar registra uma)", async () => {
    await chamar("[mock:erro-credito]");
    await db().insert(geracoesIA).values({ tarefa: "pesquisaNaHora", versaoPrompt: "1", modelo: "mock", entradas: {}, saida: { erro: true }, criadoEm: new Date(Date.now() + 5_000) });
    expect((await faltaDeCreditoDaIA())?.causa).toBe("credito");
    // uma de verdade, sem erro, depois, apaga
    await db().insert(geracoesIA).values({ tarefa: "roteiro", versaoPrompt: "1", modelo: "mock", entradas: {}, saida: { ok: true }, criadoEm: new Date(Date.now() + 6_000) });
    expect(await faltaDeCreditoDaIA()).toBeNull();
  });

  it("sobrecarga e chave recusada ficam anotadas e não viram o aviso de crédito", async () => {
    await chamar("[mock:erro-sobrecarga]");
    expect(await faltaDeCreditoDaIA()).toBeNull();
    await chamar("[mock:erro-chave]");
    expect(await faltaDeCreditoDaIA()).toBeNull();
  });

  it("o Início do admin traz a falta de crédito quando vale, e nada quando não", async () => {
    expect((await inicioDoAdmin()).atencao.creditoDaIA).toBeNull();
    await chamar("[mock:erro-credito]");
    const inicio = await inicioDoAdmin();
    expect(inicio.atencao.creditoDaIA?.tarefa).toBe("roteiro");
    expect(inicio.atencao.creditoDaIA?.desde.getTime()).toBeGreaterThan(Date.now() - 60_000);
    await db().insert(geracoesIA).values({ tarefa: "roteiro", versaoPrompt: "1", modelo: "mock", entradas: {}, criadoEm: new Date(Date.now() + 5_000) });
    expect((await inicioDoAdmin()).atencao.creditoDaIA).toBeNull();
  });
});

describe("a anotação", () => {
  it("anotar de novo atualiza em vez de duplicar", async () => {
    await registrarFalhaDaIA("credito", "roteiro", new Date("2026-10-14T10:00:00Z"));
    await registrarFalhaDaIA("credito", "nota", new Date("2026-10-14T11:00:00Z"));
    const linhas = await db().select().from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, chaveDaFalhaDaIA("credito")));
    expect(linhas).toHaveLength(1);
    expect(lerFalhaDaIA(linhas[0].valor)?.tarefa).toBe("nota");
  });
});
