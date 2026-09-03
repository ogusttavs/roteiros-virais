/**
 * Consultas do admin de coleta (etapa 6, parte 2): contagem de vídeos e
 * contas vigiadas por nicho, e as execuções de job mais recentes. So
 * leitura, sem regra de negocio: as telas `/admin/nichos` e `/admin/jobs`
 * chamam direto.
 */
import { count, desc, eq, max } from "drizzle-orm";

import { db } from "@/db";
import { briefings, clientes, contas, execucoesJob, nichos, roteiros, user, videos, type Plataforma } from "@/db/schema";

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
 * Lista para /admin/clientes (AdminTela.dc.html): junta nota do briefing e a
 * data do roteiro mais recente. "dias sem gravar" usa criadoEm do roteiro
 * como aproximacao (nao ha um campo "gravado em" separado no schema; a
 * etapa 11, que ainda nao existe, e quem decide se precisa de um).
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

  const agora = Date.now();
  return linhas.map((linha) => {
    const notaGeral = notas.find((n) => n.clienteId === linha.id)?.notaGeral ?? null;
    const ultimaTexto = ultimosRoteiros.find((r) => r.clienteId === linha.id)?.ultima ?? null;
    const ultimoRoteiro = ultimaTexto ? new Date(ultimaTexto) : null;
    const diasSemGravar = ultimoRoteiro
      ? Math.floor((agora - ultimoRoteiro.getTime()) / (1000 * 60 * 60 * 24))
      : null;
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
