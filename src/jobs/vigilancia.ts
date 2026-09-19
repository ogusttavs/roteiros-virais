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
 *
 * Conta semente (`origem = 'curadoria'`, preparação da viagem, item 2) é
 * diferente de conta de seed: é real, só entrou pelo admin em vez de
 * descoberta pelo motor. Fica sempre `vigiada = true`, nunca disputa o
 * ranking nem o teto de `vigilanciaPorNicho`: é escolha de gente, não
 * mérito por taxa fora da curva.
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { config } from "@/lib/config";

const MINIMO_VIDEOS_VIGILANCIA = 8;

export async function rodarVigilancia(): Promise<Record<string, unknown>> {
  /**
   * Conta semente (`origem = 'curadoria'`) fica sempre vigiada, nunca
   * resetada nem competindo pelo teto do ranking (preparação da viagem,
   * item 2): sem o Apify, a semente é a única entrada de conta do
   * Instagram num nicho novo, e uma semente recém colada (zero vídeo) ou
   * de conta que posta pouco perdia o `vigiada` na madrugada seguinte e
   * nunca mais era lida. O reset e o ranking abaixo valem só para as
   * outras contas.
   */
  const reset = await db().execute(sql`UPDATE contas SET vigiada = false WHERE origem <> 'curadoria'`);
  await db().execute(sql`UPDATE contas SET vigiada = true WHERE origem = 'curadoria'`);

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
      -- Semente nunca conta no teto de 50 por nicho e plataforma (item 2): e escolha de gente, o ranking e da maquina.
      WHERE c.origem <> 'curadoria'
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
