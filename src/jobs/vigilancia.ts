/**
 * Job `vigilancia` (etapa 7, escopo 5.3): por nicho e por plataforma, as
 * `config.regras.vigilanciaPorNicho` contas com maior `taxa_fora_da_curva`
 * entre as que têm pelo menos 8 vídeos não-seed nos últimos 90 dias ficam
 * `vigiada = true`; o resto (inclusive quem caiu do ranking desde a última
 * rodada) volta para `false`. Os jobs de coleta (`coleta-youtube.ts`,
 * `coleta-apify.ts`) já leem `contas.vigiada` para a coleta por perfil, sem
 * mudança nenhuma nesta etapa; contas descobertas por termo entram na
 * vigilância (e na coleta por perfil) a partir da rodada seguinte.
 *
 * Diferente da regra geral do projeto ("filtra origem <> 'seed' fora de
 * desenvolvimento"), aqui a exclusão de conta de seed vale mesmo em
 * desenvolvimento: marcar uma conta fictícia como vigiada faria os jobs de
 * coleta tentarem raspar um perfil que não existe de verdade.
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { config } from "@/lib/config";

const MINIMO_VIDEOS_VIGILANCIA = 8;

export async function rodarVigilancia(): Promise<Record<string, unknown>> {
  const reset = await db().execute(sql`UPDATE contas SET vigiada = false`);

  const marcadas = await db().execute(sql`
    WITH candidatas AS (
      SELECT conta_id, count(*) AS n
      FROM videos
      WHERE publicado_em >= now() - interval '90 days' AND origem <> 'seed'
      GROUP BY conta_id
      HAVING count(*) >= ${MINIMO_VIDEOS_VIGILANCIA}
    ),
    ranqueadas AS (
      SELECT
        c.id AS conta_id,
        row_number() OVER (
          PARTITION BY c.nicho_id, c.plataforma
          ORDER BY c.taxa_fora_da_curva DESC NULLS LAST
        ) AS posicao
      FROM contas c
      JOIN candidatas cd ON cd.conta_id = c.id
    )
    UPDATE contas c
    SET vigiada = true
    FROM ranqueadas r
    WHERE c.id = r.conta_id AND r.posicao <= ${config.regras.vigilanciaPorNicho}
  `);

  return {
    contasAvaliadas: reset.rowCount ?? 0,
    contasVigiadas: marcadas.rowCount ?? 0,
  };
}
