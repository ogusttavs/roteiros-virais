/**
 * A conferência barata "este vídeo é do setor?" (`conferirVideoDoSetor`, hotfix de 22/10/2026), no ponto comum a quem a usa: o `comentarios-semana` (antes de gastar cota lendo comentários) e
 * a faxina das contas fora do setor (`jobs/faxina-de-contas.ts`). O que a base já sabe de um vídeo, em ordem: a análise (`analise.pertenceAoNicho`), depois a conferência guardada em
 * `videos.conferencia_setor` feita pela versão atual do prompt. Uma chamada confere até `VIDEOS_POR_CHAMADA` vídeos, grava a resposta de cada um e registra a geração (o custo).
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { videos, type ConferenciaDoSetor } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as conferirVideoDoSetorIA from "@/ia/prompts/conferirVideoDoSetor";
import { calcularCustoUsd, registrarGeracao } from "@/ia/registro";

/** O vídeo com o que a base já sabe dele sobre o setor, para decidir se vale perguntar. */
export type VideoParaConferir = {
  id: number;
  titulo: string | null;
  descricao: string | null;
  fala: string | null;
  /** `analise.pertenceAoNicho`, quando a análise em lote já passou por ele: 'true' ou 'false'. */
  analisePertence: string | null;
  conferencia: ConferenciaDoSetor | null;
};

export type SetorParaConferir = { id: number; nome: string; descricao: string | null; termos: string[] };

/** O que a base sabe: a análise do vídeo manda; senão, a conferência barata feita pela versão atual do prompt; senão, ainda não se sabe. */
export function pertenceSegundoABase(c: Pick<VideoParaConferir, "analisePertence" | "conferencia">): boolean | undefined {
  if (c.analisePertence === "true") return true;
  if (c.analisePertence === "false") return false;
  if (c.conferencia && c.conferencia.versao === conferirVideoDoSetorIA.versao) return c.conferencia.pertence;
  return undefined;
}

/**
 * Uma chamada barata para um lote (no máximo `VIDEOS_POR_CHAMADA`): guarda a resposta de cada vídeo em `videos.conferencia_setor`, registra a geração e devolve quem foi respondido. Quem o
 * modelo esqueceu não entra no mapa. A IA fora lança o erro (quem chama decide: o `comentarios-semana` e a faxina param o setor ali). `contexto` entra nas entradas do registro, só para o admin
 * ver de qual rotina veio.
 */
export async function conferirLoteDoSetor(
  setor: SetorParaConferir,
  lote: VideoParaConferir[],
  agora: Date,
  contexto?: Record<string, unknown>,
): Promise<{ pertence: Map<number, boolean>; custoUsd: number }> {
  const pertence = new Map<number, boolean>();
  const numerados = lote.slice(0, conferirVideoDoSetorIA.VIDEOS_POR_CHAMADA).map((c, i) => ({ numero: i + 1, titulo: c.titulo, descricao: c.descricao, fala: c.fala }));
  const resultado = await gerarEstruturado({
    tarefa: "conferirVideoDoSetor",
    nivel: conferirVideoDoSetorIA.nivel,
    effort: conferirVideoDoSetorIA.esforco,
    schema: conferirVideoDoSetorIA.schema,
    sistemaEstavel: conferirVideoDoSetorIA.montarSistemaEstavel(),
    entrada: conferirVideoDoSetorIA.montarEntrada({ setor: setor.nome, descricaoDoSetor: setor.descricao, termos: setor.termos, videos: numerados }),
  });
  for (const resposta of resultado.dados.videos) {
    const video = lote[resposta.numero - 1];
    if (!video || pertence.has(video.id)) continue;
    const conferencia: ConferenciaDoSetor = { pertence: resposta.pertence, motivo: resposta.motivo.slice(0, 200), versao: conferirVideoDoSetorIA.versao, em: agora.toISOString() };
    await db().update(videos).set({ conferenciaSetor: conferencia }).where(eq(videos.id, video.id));
    pertence.set(video.id, resposta.pertence);
  }
  const uso = {
    tokensEntrada: resultado.tokensEntrada,
    tokensSaida: resultado.tokensSaida,
    tokensCacheLeitura: resultado.tokensCacheLeitura,
    tokensCacheEscrita: resultado.tokensCacheEscrita,
  };
  await registrarGeracao({
    tarefa: "conferirVideoDoSetor",
    versaoPrompt: conferirVideoDoSetorIA.versao,
    modelo: resultado.modelo,
    nivel: conferirVideoDoSetorIA.nivel,
    entradas: { nichoId: setor.id, videos: lote.map((c) => c.id), ...contexto },
    saida: resultado.dados,
    uso,
  });
  return { pertence, custoUsd: calcularCustoUsd(conferirVideoDoSetorIA.nivel, uso) };
}
