/**
 * Consultas do admin de coleta (etapa 6, parte 2, criterio de aceite: admin
 * renderizando execucoes com erro legivel): contagem de videos por nicho e
 * plataforma, contas vigiadas, e as execucoes de job mais recentes com a
 * mensagem de erro passando intacta.
 */
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, contas, execucoesJob, nichos, roteiros, user, videos } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import {
  listarClientesAdmin,
  listarExecucoesRecentes,
  listarNichosComContagem,
  resumoMedianaPorPlataforma,
  taxaDeAcertoPorExecucao,
  ultimaExecucaoPorJob,
} from "@/servicos/admin-coleta";
import { constanciaDoCliente } from "@/servicos/temas";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());

  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "admin-coleta-teste", nome: "Admin coleta teste", termos: ["dentista"] })
    .returning();
  nichoId = nicho.id;

  const [contaYoutube] = await db()
    .insert(contas)
    .values({ plataforma: "youtube", handle: "@exemplo", nichoId, vigiada: true })
    .returning();
  const [contaTiktok] = await db()
    .insert(contas)
    .values({ plataforma: "tiktok", handle: "exemplo.tiktok", nichoId, vigiada: false })
    .returning();

  await db()
    .insert(videos)
    .values([
      {
        plataforma: "youtube",
        idExterno: "yt1",
        url: "https://youtube.com/1",
        contaId: contaYoutube.id,
        nichoId,
      },
      {
        plataforma: "youtube",
        idExterno: "yt2",
        url: "https://youtube.com/2",
        contaId: contaYoutube.id,
        nichoId,
      },
      {
        plataforma: "tiktok",
        idExterno: "tt1",
        url: "https://tiktok.com/1",
        contaId: contaTiktok.id,
        nichoId,
      },
    ]);

  await db()
    .insert(execucoesJob)
    .values([
      {
        nome: "coleta-youtube",
        status: "ok",
        iniciadoEm: new Date("2026-09-01T10:00:00Z"),
        terminadoEm: new Date("2026-09-01T10:00:05Z"),
        resumo: { videosNovos: 3 },
      },
      {
        nome: "coleta-youtube",
        status: "erro",
        iniciadoEm: new Date("2026-09-02T10:00:00Z"),
        terminadoEm: new Date("2026-09-02T10:00:01Z"),
        erro: "nenhum termo nem canal para coletar (sem nichos ativos ou cota diaria zerada)",
      },
      {
        nome: "coleta-noticias",
        status: "ok",
        iniciadoEm: new Date("2026-09-02T06:00:00Z"),
        terminadoEm: new Date("2026-09-02T06:00:09Z"),
        resumo: { noticiasProcessadas: 12 },
      },
    ]);
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("listarNichosComContagem", () => {
  it("conta videos por plataforma e contas vigiadas, por nicho", async () => {
    const nichosListados = await listarNichosComContagem();
    const nicho = nichosListados.find((n) => n.id === nichoId);

    expect(nicho).toBeDefined();
    expect(nicho?.videosPorPlataforma).toEqual({ youtube: 2, tiktok: 1, instagram: 0 });
    expect(nicho?.contasVigiadas).toBe(1);
  });
});

describe("listarExecucoesRecentes", () => {
  it("devolve as execucoes mais recentes primeiro, com a mensagem de erro legivel", async () => {
    const execucoes = await listarExecucoesRecentes();

    expect(execucoes.length).toBeGreaterThanOrEqual(3);
    const [maisRecente] = execucoes;
    expect(maisRecente.nome).toBe("coleta-noticias");
    expect(maisRecente.status).toBe("ok");
    expect(maisRecente.duracaoMs).toBe(9000);

    const comErro = execucoes.find((e) => e.status === "erro");
    expect(comErro?.erro).toBe("nenhum termo nem canal para coletar (sem nichos ativos ou cota diaria zerada)");
  });

  it("filtra por nome do job", async () => {
    const execucoes = await listarExecucoesRecentes("coleta-youtube");
    expect(execucoes.every((e) => e.nome === "coleta-youtube")).toBe(true);
    expect(execucoes.length).toBe(2);
  });

  it("respeita o limite", async () => {
    const execucoes = await listarExecucoesRecentes(undefined, 1);
    expect(execucoes).toHaveLength(1);
  });
});

describe("taxaDeAcertoPorExecucao (E6 parte 3, terceira rodada, item 5)", () => {
  it("conta, por execucao, quantos videos ela trouxe e quantos ja viraram fora da curva (limiar 1,5)", async () => {
    // Nicho e nome de job proprios (nunca "coleta-apify"): este arquivo compartilha `nichoId` e a
    // tabela `execucoes_job` inteira entre describes, sem afterEach; usar o nicho ou o nome de job
    // do `beforeAll` mudaria a contagem de outros testes (resumoMedianaPorPlataforma,
    // ultimaExecucaoPorJob).
    const [nichoTaxa] = await db()
      .insert(nichos)
      .values({ slug: "admin-coleta-taxa-teste", nome: "Admin coleta taxa teste", termos: [] })
      .returning();
    const [execucaoA] = await db().insert(execucoesJob).values({ nome: "coleta-apify-taxa-teste" }).returning();
    const [execucaoB] = await db().insert(execucoesJob).values({ nome: "coleta-apify-taxa-teste" }).returning();
    const [contaTaxa] = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "taxa-de-acerto", nichoId: nichoTaxa.id })
      .returning();

    await db()
      .insert(videos)
      .values([
        // Execucao A: 3 videos, 2 acima do limiar (1,5), 1 abaixo.
        { plataforma: "tiktok", idExterno: "taxa-a1", url: "https://x/a1", contaId: contaTaxa.id, nichoId: nichoTaxa.id, foraDaCurva: "2.0", execucaoId: execucaoA.id },
        { plataforma: "tiktok", idExterno: "taxa-a2", url: "https://x/a2", contaId: contaTaxa.id, nichoId: nichoTaxa.id, foraDaCurva: "1.5", execucaoId: execucaoA.id },
        { plataforma: "tiktok", idExterno: "taxa-a3", url: "https://x/a3", contaId: contaTaxa.id, nichoId: nichoTaxa.id, foraDaCurva: "1.0", execucaoId: execucaoA.id },
        // Execucao B: 1 video, ainda sem fora_da_curva (pontuar nao rodou).
        { plataforma: "tiktok", idExterno: "taxa-b1", url: "https://x/b1", contaId: contaTaxa.id, nichoId: nichoTaxa.id, execucaoId: execucaoB.id },
        // Video antigo (sem execucao_id, de antes desta coluna existir): nunca entra na conta.
        { plataforma: "tiktok", idExterno: "taxa-sem-execucao", url: "https://x/sx", contaId: contaTaxa.id, nichoId: nichoTaxa.id, foraDaCurva: "5.0" },
      ]);

    const resultado = await taxaDeAcertoPorExecucao([execucaoA.id, execucaoB.id]);
    const linhaA = resultado.find((r) => r.execucaoId === execucaoA.id);
    const linhaB = resultado.find((r) => r.execucaoId === execucaoB.id);

    expect(linhaA).toEqual({ execucaoId: execucaoA.id, novos: 3, foraDaCurva: 2 });
    expect(linhaB).toEqual({ execucaoId: execucaoB.id, novos: 1, foraDaCurva: 0 });
  });

  it("sem ids, devolve vazio sem consultar o banco", async () => {
    expect(await taxaDeAcertoPorExecucao([])).toEqual([]);
  });
});

describe("ultimaExecucaoPorJob", () => {
  it("devolve so a execucao mais recente de cada nome, e nulo para quem nunca rodou", async () => {
    const resultado = await ultimaExecucaoPorJob(["coleta-youtube", "coleta-noticias", "coleta-apify"]);

    expect(resultado["coleta-youtube"]?.status).toBe("erro");
    expect(resultado["coleta-noticias"]?.status).toBe("ok");
    expect(resultado["coleta-apify"]).toBeNull();
  });
});

/**
 * "dias sem gravar" (etapa 12, decisão 6 do `PROXIMO.md`): vem de
 * `constanciaDoCliente` (`gravadoEm`/`postadoEm`, não `criadoEm`), não da
 * aproximação antiga.
 */
describe("listarClientesAdmin, dias sem gravar", () => {
  const DIA_MS = 24 * 60 * 60 * 1000;
  function dataIso(diasAtras: number): string {
    return hojeISO(new Date(Date.now() - diasAtras * DIA_MS));
  }

  const CONTEUDO_MINIMO = {
    titulo: "titulo",
    duracaoS: 40,
    gancho: "gancho",
    corpo: "corpo",
    fechamento: "fechamento",
    chamadaFinal: "chamada final",
    cenas: [],
    ondeGravar: "no local do negocio",
    edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
    evidencias: [],
    semEvidencia: false,
  };

  let clienteNuncaGravouId: number;
  let clienteEmDiaId: number;
  let clienteParadoId: number;

  async function criarCliente(usuarioId: string, nome: string): Promise<number> {
    await db()
      .insert(user)
      .values({ id: usuarioId, name: nome, email: `${usuarioId}@admin-coleta.teste` });
    const [cliente] = await db().insert(clientes).values({ usuarioId, nome, nichoId }).returning();
    return cliente.id;
  }

  beforeAll(async () => {
    clienteNuncaGravouId = await criarCliente("admin-coleta-nunca-gravou", "[teste] Nunca gravou");
    clienteEmDiaId = await criarCliente("admin-coleta-em-dia", "[teste] Em dia");
    clienteParadoId = await criarCliente("admin-coleta-parado", "[teste] Parado");

    await db()
      .insert(roteiros)
      .values({
        clienteId: clienteEmDiaId,
        data: dataIso(0),
        tema: "tema de hoje",
        origem: "sugerido",
        objetivo: "alcance",
        conteudo: CONTEUDO_MINIMO,
        status: "gravado",
        gravadoEm: new Date(),
      });

    await db()
      .insert(roteiros)
      .values({
        clienteId: clienteParadoId,
        data: dataIso(6),
        tema: "tema de 6 dias atras",
        origem: "sugerido",
        objetivo: "alcance",
        conteudo: CONTEUDO_MINIMO,
        status: "gravado",
        gravadoEm: new Date(Date.now() - 6 * DIA_MS),
      });
  });

  it("nulo para quem nunca gravou nem postou nada", async () => {
    const lista = await listarClientesAdmin();
    expect(lista.find((c) => c.id === clienteNuncaGravouId)?.diasSemGravar).toBeNull();
  });

  it("zero para quem esta gravando em dia (hoje ou ontem, em sequencia)", async () => {
    const lista = await listarClientesAdmin();
    expect(lista.find((c) => c.id === clienteEmDiaId)?.diasSemGravar).toBe(0);
  });

  it("os dias corridos para quem parou, iguais aos de constanciaDoCliente (nao um numero fixo: o calculo real depende da hora exata do teste)", async () => {
    const [constancia, lista] = await Promise.all([
      constanciaDoCliente(clienteParadoId),
      listarClientesAdmin(),
    ]);
    expect(constancia.tipo).toBe("parado");
    const diasEsperados = constancia.tipo === "parado" ? constancia.dias : null;
    expect(lista.find((c) => c.id === clienteParadoId)?.diasSemGravar).toBe(diasEsperados);
  });
});

describe("resumoMedianaPorPlataforma", () => {
  it("sempre as tres plataformas, mesmo com zero conta (instagram, neste nicho)", async () => {
    const resumo = await resumoMedianaPorPlataforma(nichoId);
    const porPlataforma = new Map(resumo.map((r) => [r.plataforma, r]));

    expect(porPlataforma.get("instagram")).toEqual({
      plataforma: "instagram",
      totalContas: 0,
      contasComMediana: 0,
      contasPorOrigem: { conta: 0, seguidores: 0, setor: 0 },
      totalVideos: 0,
      videosComMultiplo: 0,
    });
    // youtube e tiktok do beforeAll: 1 conta cada, sem mediana nem foraDaCurva ainda.
    expect(porPlataforma.get("youtube")).toMatchObject({ totalContas: 1, contasComMediana: 0, totalVideos: 2 });
    expect(porPlataforma.get("tiktok")).toMatchObject({ totalContas: 1, contasComMediana: 0, totalVideos: 1 });
  });

  it("separa contas com mediana por origem, e conta video com multiplo (foraDaCurva nao nulo)", async () => {
    const [contaOrigemConta] = await db()
      .insert(contas)
      .values({
        plataforma: "youtube",
        handle: "@origem-conta",
        nichoId,
        medianaViews: "3000",
        medianaOrigem: "conta",
      })
      .returning();
    const [contaOrigemSetor] = await db()
      .insert(contas)
      .values({
        plataforma: "youtube",
        handle: "@origem-setor",
        nichoId,
        medianaViews: "3500",
        medianaOrigem: "setor",
      })
      .returning();

    await db()
      .insert(videos)
      .values([
        {
          plataforma: "youtube",
          idExterno: "yt-com-multiplo",
          url: "https://youtube.com/com-multiplo",
          contaId: contaOrigemConta.id,
          nichoId,
          foraDaCurva: "2.5",
        },
        {
          plataforma: "youtube",
          idExterno: "yt-sem-multiplo",
          url: "https://youtube.com/sem-multiplo",
          contaId: contaOrigemSetor.id,
          nichoId,
        },
      ]);

    const resumo = await resumoMedianaPorPlataforma(nichoId);
    const youtube = resumo.find((r) => r.plataforma === "youtube");

    // 3 contas de youtube agora: a original do beforeAll (sem mediana) mais as duas novas.
    expect(youtube?.totalContas).toBe(3);
    expect(youtube?.contasComMediana).toBe(2);
    expect(youtube?.contasPorOrigem).toEqual({ conta: 1, seguidores: 0, setor: 1 });
    // 4 videos de youtube agora: os 2 do beforeAll (sem multiplo) mais os 2 novos (1 com, 1 sem).
    expect(youtube?.totalVideos).toBe(4);
    expect(youtube?.videosComMultiplo).toBe(1);

    await db().delete(videos).where(inArray(videos.idExterno, ["yt-com-multiplo", "yt-sem-multiplo"]));
    await db().delete(contas).where(inArray(contas.id, [contaOrigemConta.id, contaOrigemSetor.id]));
  });
});
