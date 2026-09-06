/**
 * Consultas do admin de coleta (etapa 6, parte 2): contagem de vídeos e
 * contas vigiadas por nicho, e as execuções de job mais recentes. So
 * leitura, sem regra de negocio: as telas `/admin/nichos` e `/admin/jobs`
 * chamam direto.
 */
import { and, count, desc, eq, gte, inArray, isNotNull, max, sql, sum } from "drizzle-orm";

import { db } from "@/db";
import {
  briefings,
  clientes,
  contas,
  execucoesJob,
  geracoesIA,
  nichos,
  noticias,
  roteiros,
  temasDia,
  user,
  videos,
  type AvaliacaoGeracao,
  type Nicho,
  type Plataforma,
  type TemaDoDia,
} from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { constanciaDoCliente } from "@/servicos/temas";

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

export type ContagemPlataforma = Record<Plataforma, number>;

export type NichoComContagem = {
  id: number;
  slug: string;
  nome: string;
  ativo: boolean;
  videosPorPlataforma: ContagemPlataforma;
  contasVigiadas: number;
  ultimaLeitura: Date | null;
};

export async function listarNichosComContagem(): Promise<NichoComContagem[]> {
  const [listaNichos, contagensVideos, contagensVigiadas, ultimasLeituras] = await Promise.all([
    db().select().from(nichos),
    db()
      .select({ nichoId: videos.nichoId, plataforma: videos.plataforma, total: count() })
      .from(videos)
      .groupBy(videos.nichoId, videos.plataforma),
    db()
      .select({ nichoId: contas.nichoId, total: count() })
      .from(contas)
      .where(eq(contas.vigiada, true))
      .groupBy(contas.nichoId),
    /**
     * "ultima leitura" por nicho (AdminTela.dc.html pede um "estado" por
     * linha, mas os jobs de coleta rodam para todos os nichos ativos numa
     * execucao so, sem registro por nicho em execucoes_job; a data do
     * video mais recente do proprio nicho e o sinal real que ja temos,
     * sem inventar rastreamento novo so para esta tela).
     */
    db()
      .select({ nichoId: videos.nichoId, ultima: max(videos.coletadoEm) })
      .from(videos)
      .groupBy(videos.nichoId),
  ]);

  return listaNichos.map((nicho) => {
    const videosPorPlataforma: ContagemPlataforma = { youtube: 0, tiktok: 0, instagram: 0 };
    for (const linha of contagensVideos) {
      if (linha.nichoId === nicho.id) videosPorPlataforma[linha.plataforma] = linha.total;
    }
    const contasVigiadas = contagensVigiadas.find((l) => l.nichoId === nicho.id)?.total ?? 0;
    const ultimaLeituraTexto = ultimasLeituras.find((l) => l.nichoId === nicho.id)?.ultima ?? null;
    return {
      id: nicho.id,
      slug: nicho.slug,
      nome: nicho.nome,
      ativo: nicho.ativo,
      videosPorPlataforma,
      contasVigiadas,
      ultimaLeitura: ultimaLeituraTexto ? new Date(ultimaLeituraTexto) : null,
    };
  });
}

export type ClienteAdmin = {
  id: number;
  nome: string;
  email: string;
  nichoNome: string | null;
  ativo: boolean;
  notaBriefing: number | null;
  ultimoRoteiro: Date | null;
  diasSemGravar: number | null;
};

/**
 * Lista para /admin/clientes (AdminTela.dc.html): junta nota do briefing, a
 * data do roteiro mais recente (qualquer status, so para mostrar a coluna
 * "ultimo roteiro") e "dias sem gravar" (etapa 12, decisao 6), que vem de
 * `constanciaDoCliente` (baseada em `gravadoEm`/`postadoEm`, nao em
 * `criadoEm`): nulo quando o cliente nunca gravou nem postou nada, 0 quando
 * esta gravando hoje ou ontem (em sequencia), e os dias corridos quando
 * parou.
 */
export async function listarClientesAdmin(): Promise<ClienteAdmin[]> {
  const [linhas, notas, ultimosRoteiros] = await Promise.all([
    db()
      .select({
        id: clientes.id,
        nome: clientes.nome,
        email: user.email,
        nichoNome: nichos.nome,
        ativo: clientes.ativo,
      })
      .from(clientes)
      .innerJoin(user, eq(user.id, clientes.usuarioId))
      .leftJoin(nichos, eq(nichos.id, clientes.nichoId))
      .orderBy(clientes.criadoEm),
    db().select({ clienteId: briefings.clienteId, notaGeral: briefings.notaGeral }).from(briefings),
    db()
      .select({ clienteId: roteiros.clienteId, ultima: max(roteiros.criadoEm) })
      .from(roteiros)
      .groupBy(roteiros.clienteId),
  ]);

  const constancias = await Promise.all(
    linhas.map((linha) => constanciaDoCliente(linha.id).then((constancia) => [linha.id, constancia] as const)),
  );
  const constanciaPorCliente = new Map(constancias);

  return linhas.map((linha) => {
    const notaGeral = notas.find((n) => n.clienteId === linha.id)?.notaGeral ?? null;
    const ultimaTexto = ultimosRoteiros.find((r) => r.clienteId === linha.id)?.ultima ?? null;
    const ultimoRoteiro = ultimaTexto ? new Date(ultimaTexto) : null;
    const constancia = constanciaPorCliente.get(linha.id);
    const diasSemGravar =
      constancia?.tipo === "parado" ? constancia.dias : constancia?.tipo === "seguidos" ? 0 : null;
    return {
      ...linha,
      notaBriefing: notaGeral ? Number(notaGeral) : null,
      ultimoRoteiro,
      diasSemGravar,
    };
  });
}

export type ExecucaoResumo = {
  id: number;
  nome: string;
  iniciadoEm: Date;
  terminadoEm: Date | null;
  status: "rodando" | "ok" | "erro";
  duracaoMs: number | null;
  resumo: Record<string, unknown> | null;
  erro: string | null;
};

function mapearExecucao(linha: typeof execucoesJob.$inferSelect): ExecucaoResumo {
  return {
    id: linha.id,
    nome: linha.nome,
    iniciadoEm: linha.iniciadoEm,
    terminadoEm: linha.terminadoEm,
    status: linha.status,
    duracaoMs: linha.terminadoEm ? linha.terminadoEm.getTime() - linha.iniciadoEm.getTime() : null,
    resumo: linha.resumo,
    erro: linha.erro,
  };
}

export async function listarExecucoesRecentes(nomeFiltro?: string, limite = 50): Promise<ExecucaoResumo[]> {
  const linhas = await db()
    .select()
    .from(execucoesJob)
    .where(nomeFiltro ? eq(execucoesJob.nome, nomeFiltro) : undefined)
    .orderBy(desc(execucoesJob.id))
    .limit(limite);
  return linhas.map(mapearExecucao);
}

/** A execucao mais recente de cada nome de job (para o painel de `/admin/nichos`). */
export async function ultimaExecucaoPorJob(nomes: string[]): Promise<Record<string, ExecucaoResumo | null>> {
  const resultado: Record<string, ExecucaoResumo | null> = {};
  for (const nome of nomes) {
    const [linha] = await db()
      .select()
      .from(execucoesJob)
      .where(eq(execucoesJob.nome, nome))
      .orderBy(desc(execucoesJob.id))
      .limit(1);
    resultado[nome] = linha ? mapearExecucao(linha) : null;
  }
  return resultado;
}

/** Nicho pelo slug, para `/admin/nichos/[slug]` (etapa 7). */
export async function nichoPorSlug(slug: string): Promise<Nicho | null> {
  const [linha] = await db().select().from(nichos).where(eq(nichos.slug, slug));
  return linha ?? null;
}

export type ContaVigiada = {
  id: number;
  plataforma: Plataforma;
  handle: string;
  taxaForaDaCurva: number | null;
  medianaViews: number | null;
  /** Coleta por perfil falhou de um jeito conhecido (rodada de acabamento de 06/09, item 2). */
  avisoColeta: string | null;
};

/** A lista de vigilância de um nicho (escopo 5.3): quem está `vigiada`, por taxa. */
export async function listarContasVigiadas(nichoId: number): Promise<ContaVigiada[]> {
  const linhas = await db()
    .select({
      id: contas.id,
      plataforma: contas.plataforma,
      handle: contas.handle,
      taxaForaDaCurva: contas.taxaForaDaCurva,
      medianaViews: contas.medianaViews,
      avisoColeta: contas.avisoColeta,
    })
    .from(contas)
    .where(and(eq(contas.nichoId, nichoId), eq(contas.vigiada, true)))
    .orderBy(desc(contas.taxaForaDaCurva));

  return linhas.map((l) => ({
    id: l.id,
    plataforma: l.plataforma,
    handle: l.handle,
    taxaForaDaCurva: l.taxaForaDaCurva === null ? null : Number(l.taxaForaDaCurva),
    medianaViews: l.medianaViews === null ? null : Number(l.medianaViews),
    avisoColeta: l.avisoColeta,
  }));
}

/**
 * Os temas de hoje do nicho, exatamente como o job `temasDoDia` gravou
 * (etapa 10, decisão 8 do `PROXIMO.md`): sem a regra de estabilidade nem a
 * linha editorial, que são da experiência do cliente, não do diagnóstico
 * do admin. `null` quando o job de hoje ainda não rodou ou não gerou
 * evidência para este nicho.
 */
export async function temaDoDiaAtual(nichoId: number): Promise<TemaDoDia[] | null> {
  const [linha] = await db()
    .select({ temas: temasDia.temas })
    .from(temasDia)
    .where(and(eq(temasDia.nichoId, nichoId), eq(temasDia.data, hojeISO())));

  return linha?.temas ?? null;
}

export type VideoLinkavel = { id: number; titulo: string | null; url: string };

/** Titulo e url de alguns videos por id (etapa 9: exemplos do audio da semana). */
export async function videosPorId(ids: number[]): Promise<VideoLinkavel[]> {
  if (ids.length === 0) return [];
  return db()
    .select({ id: videos.id, titulo: videos.titulo, url: videos.url })
    .from(videos)
    .where(inArray(videos.id, ids));
}

export type NoticiaLinkavel = { id: number; titulo: string; url: string };

/**
 * Titulo e url de algumas noticias por id (correcao do dia 1 da etapa 14,
 * `PROXIMO.md`, item 1): mesmo uso de `videosPorId`, para a tela do nicho
 * mostrar a evidencia de noticia de um tema por titulo, abaixo dos videos.
 */
export async function noticiasPorId(ids: number[]): Promise<NoticiaLinkavel[]> {
  if (ids.length === 0) return [];
  return db()
    .select({ id: noticias.id, titulo: noticias.titulo, url: noticias.url })
    .from(noticias)
    .where(inArray(noticias.id, ids));
}

export type ClienteDetalheAdmin = {
  id: number;
  nome: string;
  email: string;
  nichoNome: string | null;
  ativo: boolean;
  criadoEm: Date;
  briefing: { completo: boolean; notaGeral: number | null; resumo: string | null } | null;
  diasSemGravar: number | null;
};

/** /admin/clientes/[id] (etapa 12, decisão 9 do `PROXIMO.md`): briefing, saúde da conta. Só leitura. */
export async function clienteDetalheAdmin(clienteId: number): Promise<ClienteDetalheAdmin | null> {
  const [linha] = await db()
    .select({
      id: clientes.id,
      nome: clientes.nome,
      email: user.email,
      nichoNome: nichos.nome,
      ativo: clientes.ativo,
      criadoEm: clientes.criadoEm,
    })
    .from(clientes)
    .innerJoin(user, eq(user.id, clientes.usuarioId))
    .leftJoin(nichos, eq(nichos.id, clientes.nichoId))
    .where(eq(clientes.id, clienteId));

  if (!linha) return null;

  const [briefingLinha] = await db()
    .select({ completo: briefings.completo, notaGeral: briefings.notaGeral, perfil: briefings.perfil })
    .from(briefings)
    .where(eq(briefings.clienteId, clienteId));

  const constancia = await constanciaDoCliente(clienteId);
  const diasSemGravar =
    constancia.tipo === "parado" ? constancia.dias : constancia.tipo === "seguidos" ? 0 : null;

  return {
    ...linha,
    briefing: briefingLinha
      ? {
          completo: briefingLinha.completo,
          notaGeral: briefingLinha.notaGeral ? Number(briefingLinha.notaGeral) : null,
          resumo: briefingLinha.perfil?.resumo ?? null,
        }
      : null,
    diasSemGravar,
  };
}

export type GeracaoResumo = {
  id: number;
  tarefa: string;
  modelo: string;
  versaoPrompt: string;
  custoUsd: number;
  avaliacao: AvaliacaoGeracao | null;
  motivoAvaliacao: string | null;
  criadoEm: Date;
};

export type FiltroGeracoes = { tarefa?: string; clienteId?: number };

function condicaoFiltro(filtro?: FiltroGeracoes) {
  const condicoes = [];
  if (filtro?.tarefa) condicoes.push(eq(geracoesIA.tarefa, filtro.tarefa));
  if (filtro?.clienteId) condicoes.push(eq(geracoesIA.clienteId, filtro.clienteId));
  return condicoes.length > 0 ? and(...condicoes) : undefined;
}

/**
 * /admin/geracoes (etapa 12, decisão 8 do `PROXIMO.md`; filtro por tarefa e
 * cliente na etapa 18, decisão 1 do `PROXIMO.md`): as ultimas gerações, mais
 * recentes primeiro. So leitura.
 */
export async function listarGeracoesRecentes(limite = 50, filtro?: FiltroGeracoes): Promise<GeracaoResumo[]> {
  const linhas = await db()
    .select({
      id: geracoesIA.id,
      tarefa: geracoesIA.tarefa,
      modelo: geracoesIA.modelo,
      versaoPrompt: geracoesIA.versaoPrompt,
      custoUsd: geracoesIA.custoUsd,
      avaliacao: geracoesIA.avaliacao,
      motivoAvaliacao: geracoesIA.motivoAvaliacao,
      criadoEm: geracoesIA.criadoEm,
    })
    .from(geracoesIA)
    .where(condicaoFiltro(filtro))
    .orderBy(desc(geracoesIA.criadoEm))
    .limit(limite);

  return linhas.map((l) => ({ ...l, custoUsd: Number(l.custoUsd) }));
}

/** As tarefas com pelo menos uma geração, para o filtro de `/admin/geracoes`. */
export async function listarTarefasComGeracao(): Promise<string[]> {
  const linhas = await db().selectDistinct({ tarefa: geracoesIA.tarefa }).from(geracoesIA).orderBy(geracoesIA.tarefa);
  return linhas.map((l) => l.tarefa);
}

/** Os clientes com pelo menos uma geração, para o filtro de `/admin/geracoes`. */
export async function listarClientesComGeracao(): Promise<{ id: number; nome: string }[]> {
  const linhas = await db()
    .selectDistinct({ id: clientes.id, nome: clientes.nome })
    .from(geracoesIA)
    .innerJoin(clientes, eq(clientes.id, geracoesIA.clienteId))
    .orderBy(clientes.nome);
  return linhas;
}

export type MotivosPorTarefa = { tarefa: string; motivos: { motivo: string; contagem: number }[] };

export type ResumoGeracoes = {
  periodoDias: 7 | 30;
  totalGeracoes: number;
  custoTotalUsd: number;
  custoMedioUsd: number;
  tokensEntrada: number;
  tokensSaida: number;
  tokensCache: number;
  /** tokensCache / (tokensEntrada + tokensCache); null sem nenhum token de entrada. */
  proporcaoCache: number | null;
  avaliadas: number;
  /** As tres taxas somam 1 (100%) sobre `avaliadas`, nunca sobre `totalGeracoes`: a
   * maioria das tarefas (tema, briefing, modelo do nicho) nunca recebe avaliacao do
   * cliente, so o roteiro recebe (revisao do Fable: conferir contra o banco). */
  taxaGostei: number | null;
  taxaNaoGostei: number | null;
  taxaOutroAngulo: number | null;
  /** Os 5 motivos de "outro angulo" mais frequentes, por tarefa (decisao 3 do PROXIMO.md). */
  motivosOutroAnguloPorTarefa: MotivosPorTarefa[];
};

const MOTIVOS_POR_TAREFA_LIMITE = 5;

/**
 * Resumo de `/admin/geracoes` (etapa 18, decisao 1 a 3 do `PROXIMO.md`): custo,
 * tokens e taxa de avaliacao dos ultimos `dias` dias, com filtro opcional por
 * tarefa e por cliente. So leitura, sem texto de roteiro de cliente nenhum.
 */
export async function resumoGeracoes(opcoes: {
  dias: 7 | 30;
  tarefa?: string;
  clienteId?: number;
}): Promise<ResumoGeracoes> {
  const desde = gte(geracoesIA.criadoEm, diasAtras(opcoes.dias));
  const filtroExtra = condicaoFiltro({ tarefa: opcoes.tarefa, clienteId: opcoes.clienteId });
  const filtro = filtroExtra ? and(desde, filtroExtra) : desde;

  const [totais] = await db()
    .select({
      totalGeracoes: count(),
      custoTotalUsd: sum(geracoesIA.custoUsd),
      tokensEntrada: sum(geracoesIA.tokensEntrada),
      tokensSaida: sum(geracoesIA.tokensSaida),
      tokensCache: sum(geracoesIA.tokensCache),
    })
    .from(geracoesIA)
    .where(filtro);

  const [avaliacoesLinha] = await db()
    .select({
      avaliadas: count(),
      gostei: sql<number>`count(*) filter (where ${geracoesIA.avaliacao} = 'gostei')`,
      naoGostei: sql<number>`count(*) filter (where ${geracoesIA.avaliacao} = 'nao_gostei')`,
      outroAngulo: sql<number>`count(*) filter (where ${geracoesIA.avaliacao} = 'outro_angulo')`,
    })
    .from(geracoesIA)
    .where(and(filtro, isNotNull(geracoesIA.avaliacao)));

  const motivoNormalizado = sql<string>`trim(lower(${geracoesIA.motivoAvaliacao}))`;
  const linhasMotivos = await db()
    .select({ tarefa: geracoesIA.tarefa, motivo: motivoNormalizado, contagem: count() })
    .from(geracoesIA)
    .where(
      and(
        filtro,
        eq(geracoesIA.avaliacao, "outro_angulo"),
        isNotNull(geracoesIA.motivoAvaliacao),
        sql`trim(${geracoesIA.motivoAvaliacao}) <> ''`,
      ),
    )
    .groupBy(geracoesIA.tarefa, motivoNormalizado)
    .orderBy(desc(count()));

  const motivosPorTarefa = new Map<string, { motivo: string; contagem: number }[]>();
  for (const linha of linhasMotivos) {
    const lista = motivosPorTarefa.get(linha.tarefa) ?? [];
    if (lista.length < MOTIVOS_POR_TAREFA_LIMITE) lista.push({ motivo: linha.motivo, contagem: linha.contagem });
    motivosPorTarefa.set(linha.tarefa, lista);
  }

  const totalGeracoes = totais.totalGeracoes;
  const custoTotalUsd = Number(totais.custoTotalUsd ?? 0);
  const tokensEntrada = Number(totais.tokensEntrada ?? 0);
  const tokensSaida = Number(totais.tokensSaida ?? 0);
  const tokensCache = Number(totais.tokensCache ?? 0);
  const avaliadas = avaliacoesLinha.avaliadas;

  return {
    periodoDias: opcoes.dias,
    totalGeracoes,
    custoTotalUsd,
    custoMedioUsd: totalGeracoes > 0 ? custoTotalUsd / totalGeracoes : 0,
    tokensEntrada,
    tokensSaida,
    tokensCache,
    proporcaoCache: tokensEntrada + tokensCache > 0 ? tokensCache / (tokensEntrada + tokensCache) : null,
    avaliadas,
    taxaGostei: avaliadas > 0 ? avaliacoesLinha.gostei / avaliadas : null,
    taxaNaoGostei: avaliadas > 0 ? avaliacoesLinha.naoGostei / avaliadas : null,
    taxaOutroAngulo: avaliadas > 0 ? avaliacoesLinha.outroAngulo / avaliadas : null,
    motivosOutroAnguloPorTarefa: [...motivosPorTarefa.entries()].map(([tarefa, motivos]) => ({ tarefa, motivos })),
  };
}

export type CustoClienteMes = { clienteId: number; nomeCliente: string; custoUsd: number; acimaDaMeta: boolean };

/** US$/mes por cliente antes de virar preocupacao (decisao 2 do `PROXIMO.md`). */
export const META_CUSTO_CLIENTE_USD = 5;

/**
 * Soma do custo dos ultimos 30 dias por cliente (decisao 2 do `PROXIMO.md`),
 * quem passou da meta primeiro.
 */
export async function custoPorClientePorMes(): Promise<CustoClienteMes[]> {
  const linhas = await db()
    .select({ clienteId: clientes.id, nomeCliente: clientes.nome, custoUsd: sum(geracoesIA.custoUsd) })
    .from(geracoesIA)
    .innerJoin(clientes, eq(clientes.id, geracoesIA.clienteId))
    .where(gte(geracoesIA.criadoEm, diasAtras(30)))
    .groupBy(clientes.id, clientes.nome)
    .orderBy(desc(sum(geracoesIA.custoUsd)));

  return linhas.map((l) => {
    const custoUsd = Number(l.custoUsd ?? 0);
    return { clienteId: l.clienteId, nomeCliente: l.nomeCliente, custoUsd, acimaDaMeta: custoUsd > META_CUSTO_CLIENTE_USD };
  });
}

export type GeracaoDetalhe = GeracaoResumo & {
  clienteId: number | null;
  entradas: Record<string, unknown>;
  evidencias: number[];
  saida: Record<string, unknown> | null;
  tokensEntrada: number;
  tokensSaida: number;
  tokensCache: number;
};

/** /admin/geracoes/[id] (etapa 12, decisão 8): entrada e saída de uma geração. So leitura. */
export async function geracaoPorId(id: number): Promise<GeracaoDetalhe | null> {
  const [linha] = await db().select().from(geracoesIA).where(eq(geracoesIA.id, id));
  if (!linha) return null;

  return {
    id: linha.id,
    clienteId: linha.clienteId,
    tarefa: linha.tarefa,
    modelo: linha.modelo,
    versaoPrompt: linha.versaoPrompt,
    custoUsd: Number(linha.custoUsd),
    avaliacao: linha.avaliacao,
    motivoAvaliacao: linha.motivoAvaliacao,
    criadoEm: linha.criadoEm,
    entradas: linha.entradas,
    evidencias: linha.evidencias,
    saida: linha.saida,
    tokensEntrada: linha.tokensEntrada,
    tokensSaida: linha.tokensSaida,
    tokensCache: linha.tokensCache,
  };
}
