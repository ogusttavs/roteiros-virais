/**
 * Consultas do admin de coleta (etapa 6, parte 2): contagem de vídeos e
 * contas vigiadas por nicho, e as execuções de job mais recentes. So
 * leitura, sem regra de negocio: as telas `/admin/nichos` e `/admin/jobs`
 * chamam direto.
 */
import { count, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { contas, execucoesJob, nichos, videos, type Plataforma } from "@/db/schema";

export type ContagemPlataforma = Record<Plataforma, number>;

export type NichoComContagem = {
  id: number;
  slug: string;
  nome: string;
  ativo: boolean;
  videosPorPlataforma: ContagemPlataforma;
  contasVigiadas: number;
};

export async function listarNichosComContagem(): Promise<NichoComContagem[]> {
  const [listaNichos, contagensVideos, contagensVigiadas] = await Promise.all([
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
  ]);

  return listaNichos.map((nicho) => {
    const videosPorPlataforma: ContagemPlataforma = { youtube: 0, tiktok: 0, instagram: 0 };
    for (const linha of contagensVideos) {
      if (linha.nichoId === nicho.id) videosPorPlataforma[linha.plataforma] = linha.total;
    }
    const contasVigiadas = contagensVigiadas.find((l) => l.nichoId === nicho.id)?.total ?? 0;
    return {
      id: nicho.id,
      slug: nicho.slug,
      nome: nicho.nome,
      ativo: nicho.ativo,
      videosPorPlataforma,
      contasVigiadas,
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
