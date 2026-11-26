/**
 * M3 da auditoria de segurança de 26/11/2026: as funções de serviço que recebiam só o id e confiavam em quem chama para conferir a marca agora recebem o `clienteId` e filtram por
 * ele no próprio SQL. Este teste chama cada uma com o id de um dado da marca B em nome da marca A e confere que nada da marca B é lido nem gravado (e, para provar que o filtro
 * não recusa tudo, a mesma chamada em nome da marca B funciona). Contra o Postgres real; a IA fica simulada (nenhuma destas chamadas chega a ela no caso recusado).
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const enviados: { fila: string; dados: unknown }[] = [];
vi.mock("@/jobs/fila", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/fila")>();
  return {
    ...original,
    garantirBossPronto: vi.fn(async () => undefined),
    boss: () => ({
      send: vi.fn(async (fila: string, dados: unknown) => {
        enviados.push({ fila, dados });
        return "job";
      }),
    }),
  };
});

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, nichos, perfisCitados, planoGravacoes, roteiros, user, videosCliente, type PerfilCompilado } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { curvasDoHistorico } from "@/servicos/curva";
import { enfileirarAnaliseDePerfil } from "@/servicos/perfis-analisados";
import { desmarcarGravado as desmarcarGravadoNoPlano, marcarGravado as marcarGravadoNoPlano, pular } from "@/servicos/plano";
import {
  arquivarRoteiro,
  avaliarRoteiro,
  conferirAindaVale,
  desarquivarRoteiro,
  editarRoteiro,
  marcarGravado,
  marcarPostado,
  mudarDataRoteiro,
  reprovarERescrever,
  somarDiasISO,
  versoesDoRoteiro,
} from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

const PERFIL: PerfilCompilado = {
  fatos: { oQueVende: "lavagem de estofados", preco: "R$ 180", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
  resumo: "lava estofados em domicilio",
  referencias: [],
};

let nichoId: number;
let contador = 0;

async function criarMarca() {
  contador += 1;
  const usuarioId = `isolamento-${contador}`;
  await db().insert(user).values({ id: usuarioId, name: `[teste] isolamento ${contador}`, email: `${usuarioId}@isolamento.teste` });
  const [cliente] = await db().insert(clientes).values({ usuarioId, nome: `[teste] isolamento ${contador}`, nichoId }).returning();
  await db().insert(briefings).values({ clienteId: cliente.id, completo: true, perfil: PERFIL });
  return cliente;
}

async function criarRoteiro(clienteId: number, extra: Partial<typeof roteiros.$inferInsert> = {}) {
  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: hojeISO(),
      tema: "o sofá que parece novo",
      origem: "livre",
      objetivo: "engajamento",
      conteudo: {
        titulo: "t",
        duracaoS: 30,
        gancho: "o gancho original",
        corpo: "c",
        fechamento: "f",
        chamadaFinal: "cf",
        cartoes: null,
        porQueAssim: [],
        cenas: [],
        ondeGravar: "o",
        edicao: { textoNaTela: [], ritmoDeCorte: "", recursos: [], audio: null, referencia: null },
        evidencias: [],
        semEvidencia: true,
        forcaEvidencia: null,
      },
      ...extra,
    })
    .returning();
  return roteiro;
}

async function linhaDoRoteiro(id: number) {
  const [linha] = await db().select().from(roteiros).where(eq(roteiros.id, id));
  return linha;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "isolamento-teste", nome: "Isolamento teste" }).returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  enviados.length = 0;
  await db().delete(videosCliente);
  await db().update(planoGravacoes).set({ roteiroId: null });
  await db().delete(planoGravacoes);
  await db().update(roteiros).set({ geracaoId: null });
  await db().delete(roteiros);
  await db().delete(geracoesIA);
});

describe("roteiro.ts: o roteiro de outra marca é 'não achei', nunca lido nem gravado", () => {
  it("reprovarERescrever não reprova nem escreve versão nova do roteiro de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    await expect(reprovarERescrever(deB.id, a.id, ["gancho_fraco"])).rejects.toThrow("roteiro nao encontrado.");
    expect((await linhaDoRoteiro(deB.id)).reprovadoEm).toBeNull();
    expect(await db().select().from(roteiros).where(eq(roteiros.clienteId, b.id))).toHaveLength(1);
  });

  it("editarRoteiro não muda o texto do roteiro de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    await expect(editarRoteiro(deB.id, a.id, { gancho: "escrito pela marca A" })).rejects.toThrow("roteiro nao encontrado.");
    const depois = await linhaDoRoteiro(deB.id);
    expect(depois.conteudo.gancho).toBe("o gancho original");
    expect(depois.editadoPelaPessoa).toBe(false);
    // A própria marca edita normalmente.
    const editado = await editarRoteiro(deB.id, b.id, { gancho: "escrito pela marca B" });
    expect(editado.conteudo.gancho).toBe("escrito pela marca B");
  });

  it("marcarGravado e marcarPostado não mexem no roteiro de outra marca nem criam vídeo para a curva", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    await expect(marcarGravado(deB.id, a.id)).rejects.toThrow("roteiro nao encontrado.");
    await expect(marcarPostado(deB.id, a.id, "https://www.tiktok.com/@x/video/123")).rejects.toThrow("roteiro nao encontrado.");
    expect((await linhaDoRoteiro(deB.id)).status).toBe("gerado");
    expect(await db().select().from(videosCliente)).toHaveLength(0);
    expect((await marcarGravado(deB.id, b.id)).status).toBe("gravado");
    expect((await marcarPostado(deB.id, b.id, "https://www.tiktok.com/@x/video/123")).status).toBe("postado");
  });

  it("avaliarRoteiro não grava a nota na geração do roteiro de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const [geracao] = await db().insert(geracoesIA).values({ tarefa: "roteiro", versaoPrompt: "v1", modelo: "simulado", entradas: {}, clienteId: b.id }).returning();
    const deB = await criarRoteiro(b.id, { geracaoId: geracao.id });
    await expect(avaliarRoteiro(deB.id, a.id, "gostei")).rejects.toThrow("roteiro nao encontrado.");
    const [antes] = await db().select().from(geracoesIA).where(eq(geracoesIA.id, geracao.id));
    expect(antes.avaliacao).toBeNull();
    await avaliarRoteiro(deB.id, b.id, "gostei");
    const [depois] = await db().select().from(geracoesIA).where(eq(geracoesIA.id, geracao.id));
    expect(depois.avaliacao).toBe("gostei");
  });

  it("versoesDoRoteiro não lê a série de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    await expect(versoesDoRoteiro(deB.id, a.id)).rejects.toThrow("roteiro nao encontrado.");
    expect((await versoesDoRoteiro(deB.id, b.id)).map((v) => v.id)).toEqual([deB.id]);
  });

  it("arquivar, desarquivar e mudar o dia não mexem no roteiro de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    await arquivarRoteiro(deB.id, a.id);
    expect((await linhaDoRoteiro(deB.id)).arquivadoEm).toBeNull();

    await arquivarRoteiro(deB.id, b.id);
    expect((await linhaDoRoteiro(deB.id)).arquivadoEm).not.toBeNull();
    await desarquivarRoteiro(deB.id, a.id);
    expect((await linhaDoRoteiro(deB.id)).arquivadoEm).not.toBeNull();
    await desarquivarRoteiro(deB.id, b.id);
    expect((await linhaDoRoteiro(deB.id)).arquivadoEm).toBeNull();

    const daquiATres = somarDiasISO(hojeISO(), 3);
    await mudarDataRoteiro(deB.id, a.id, daquiATres);
    expect((await linhaDoRoteiro(deB.id)).data).toBe(hojeISO());
    await mudarDataRoteiro(deB.id, b.id, daquiATres);
    expect((await linhaDoRoteiro(deB.id)).data).toBe(daquiATres);
  });

  it("conferirAindaVale não confere nem guarda a resposta no roteiro de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    await expect(conferirAindaVale(deB.id, a.id)).rejects.toThrow("roteiro nao encontrado.");
    expect((await linhaDoRoteiro(deB.id)).aindaValeChecadoEm).toBeNull();
    // Sem nada subindo no setor, a própria marca recebe "ainda vale" sem chamar a IA, e a resposta fica guardada.
    expect(await conferirAindaVale(deB.id, b.id)).toEqual({ vale: true });
    expect((await linhaDoRoteiro(deB.id)).aindaValeChecadoEm).not.toBeNull();
  });
});

describe("plano.ts: o item do plano de outra marca não fecha nem volta", () => {
  async function itemAceito(clienteId: number, roteiroId: number, estado: "aceito" | "gravado" | "sugerido" = "aceito") {
    const [item] = await db()
      .insert(planoGravacoes)
      .values({ clienteId, dia: hojeISO(), ordem: 1, lugar: "loja", situacao: "dia de movimento", oQueMostrar: "o balcão", objetivo: "engajamento", estado, roteiroId: estado === "sugerido" ? null : roteiroId })
      .returning();
    return item;
  }
  async function estadoDoItem(id: number) {
    const [linha] = await db().select().from(planoGravacoes).where(eq(planoGravacoes.id, id));
    return linha.estado;
  }

  it("marcarGravado e desmarcarGravado do plano só valem para a marca dona do item", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    const item = await itemAceito(b.id, deB.id);

    await marcarGravadoNoPlano(deB.id, a.id);
    expect(await estadoDoItem(item.id)).toBe("aceito");
    await marcarGravadoNoPlano(deB.id, b.id);
    expect(await estadoDoItem(item.id)).toBe("gravado");

    await desmarcarGravadoNoPlano(deB.id, a.id);
    expect(await estadoDoItem(item.id)).toBe("gravado");
    await desmarcarGravadoNoPlano(deB.id, b.id);
    expect(await estadoDoItem(item.id)).toBe("aceito");
  });

  it("pular não pula o item de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    const item = await itemAceito(b.id, deB.id, "sugerido");
    await expect(pular(item.id, a.id)).rejects.toThrow("item do plano nao encontrado.");
    expect(await estadoDoItem(item.id)).toBe("sugerido");
    await pular(item.id, b.id);
    expect(await estadoDoItem(item.id)).toBe("pulado");
  });
});

describe("perfis-analisados.ts: o perfil citado de outra marca não entra na fila em nome desta", () => {
  it("enfileirarAnaliseDePerfil só manda o perfil citado da própria marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const [citadoDeB] = await db().insert(perfisCitados).values({ clienteId: b.id, tipo: "concorrente", rede: "instagram", handle: "concorrente_de_b" }).returning();

    await enfileirarAnaliseDePerfil(a.id, citadoDeB.id);
    expect(enviados).toEqual([]);

    await enfileirarAnaliseDePerfil(b.id, citadoDeB.id);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].dados).toMatchObject({ clienteId: b.id, perfilCitadoId: citadoDeB.id, handle: "concorrente_de_b" });
  });
});

describe("curva.ts: a curva do vídeo de outra marca não aparece no histórico desta", () => {
  it("curvasDoHistorico só devolve a curva dos vídeos da própria marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id, { status: "postado" });
    await db().insert(videosCliente).values({ clienteId: b.id, roteiroId: deB.id, url: "https://exemplo.invalido/b", postadoEm: new Date() });

    expect((await curvasDoHistorico(a.id, [deB.id])).has(deB.id)).toBe(false);
    expect((await curvasDoHistorico(b.id, [deB.id])).get(deB.id)).toEqual({ status: "sem_acompanhamento" });
  });
});
