/**
 * E17 parte 1, a busca por significado: dado o texto de um tema, os vídeos do setor cujo vetor (`embeddings_video`) está mais perto do vetor do texto, pela distância de cosseno.
 *
 * **Desligada por padrão** (`BUSCA_POR_SIGNIFICADO`): desligada, devolve lista vazia sem chamar a porta de embeddings, e a evidência do tema livre é exatamente a de antes. Ligada, o resultado é
 * SOMADO ao que a busca por texto já acha (`evidenciaParaTema`, `servicos/pesquisa.ts`); nunca substitui, e todos os filtros de hoje (setor, piso de views, janela, análise, brasileiro, formato)
 * continuam valendo por cima, porque quem chama passa as mesmas condições da evidência (`condicoesBase`).
 *
 * Nunca quebra a evidência: se a porta falhar, ou ainda não houver vetor, a lista volta vazia e fica um aviso no log; a busca por texto segue sozinha.
 *
 * Sem índice aproximado de propósito (`entregaveis/revisoes/e17-escopo.md`): as condições reduzem a poucos milhares de linhas antes da ordenação, e a varredura exata é rápida e não perde resultado.
 */
import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { config } from "@/lib/config";
import { portaEmbeddings } from "@/lib/embeddings";
import { logger } from "@/lib/log";
import { custoDosVetoresUsd, registrarCustoExterno } from "@/servicos/custos-externos";

/**
 * A distância de cosseno máxima (0 é igual, 1 é sem relação) que ainda conta como "parecido". **Provisória**: com a porta simulada o número não significa nada, e com a Voyage precisa de golden set
 * (E17 parte 2). `BUSCA_POR_SIGNIFICADO_DISTANCIA_MAX` ajusta sem mexer em código.
 */
export const DISTANCIA_MAXIMA_PADRAO = 0.6;

function distanciaMaxima(): number {
  const v = Number(process.env.BUSCA_POR_SIGNIFICADO_DISTANCIA_MAX);
  return Number.isFinite(v) && process.env.BUSCA_POR_SIGNIFICADO_DISTANCIA_MAX !== "" && v > 0 ? v : DISTANCIA_MAXIMA_PADRAO;
}

/** Um vetor no formato de texto que o pgvector lê: "[0.1,0.2,...]". */
export function vetorComoTexto(vetor: number[]): string {
  return `[${vetor.join(",")}]`;
}

export type OpcoesDaBuscaPorSignificado = {
  /** Sobrescreve `BUSCA_POR_SIGNIFICADO` (testes). */
  ativa?: boolean;
  /** Quantos vizinhos, no máximo (padrão `BUSCA_POR_SIGNIFICADO_VIZINHOS`). */
  vizinhos?: number;
  /** Distância de cosseno máxima (padrão `DISTANCIA_MAXIMA_PADRAO`). */
  distanciaMax?: number;
};

/**
 * Os ids dos vídeos mais parecidos com o `texto`, do mais perto para o mais longe. `condicoesBase` são as condições de `videos` da evidência (setor com piso, janela, análise, e o resto): só
 * entra vídeo que passa nelas, para a lista não gastar vaga com quem a evidência cortaria depois.
 */
export async function vizinhosPorSignificado(texto: string, condicoesBase: SQL[], opcoes: OpcoesDaBuscaPorSignificado = {}): Promise<number[]> {
  const ativa = opcoes.ativa ?? config.embeddings.buscaAtiva;
  if (!ativa || texto.trim() === "") return [];
  const limite = Math.max(1, Math.floor(opcoes.vizinhos ?? config.embeddings.vizinhos));
  const distanciaMax = opcoes.distanciaMax ?? distanciaMaxima();

  try {
    const porta = portaEmbeddings();
    const { vetores, tokens } = await porta.embedar([texto], "consulta");
    await registrarCustoExterno({
      fonte: "voyage",
      custoUsd: custoDosVetoresUsd(tokens),
      unidades: tokens,
      unidade: "tokens",
      origemDoCusto: "estimado",
      ramoId: null,
      detalhe: { modelo: porta.modelo, uso: "busca" },
    });
    const consulta = vetorComoTexto(vetores[0]);
    const resultado = await db().execute<{ video_id: number }>(sql`
      select ev.video_id
      from embeddings_video ev
      join videos on videos.id = ev.video_id
      where ev.modelo = ${porta.modelo}
        and ${sql.join(condicoesBase, sql` and `)}
        and (ev.vetor <=> ${consulta}::vector) <= ${distanciaMax}
      order by ev.vetor <=> ${consulta}::vector, videos.id
      limit ${limite}
    `);
    return resultado.rows.map((l) => Number(l.video_id));
  } catch (erro) {
    logger.warn({ err: erro }, "busca por significado falhou; a evidencia segue so com a busca por texto");
    return [];
  }
}
