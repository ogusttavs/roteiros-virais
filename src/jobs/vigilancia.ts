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
 *
 * V2b, item 7 (escopo 5.11: o Brasil primeiro): o ranking por nicho e
 * plataforma passa a preferir conta brasileira (`pais = 'BR'` ou
 * `idioma_principal` português) antes da taxa fora da curva; conta de
 * idioma principal "outro" nunca é vigiada, mesmo com taxa alta (fica de
 * fora do ranking desde o `WHERE`, não só perde posição). A semente
 * continua sempre vigiada qualquer que seja o idioma, é escolha de gente.
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
          -- COALESCE(..., false) e necessario (achado ao testar): pais='BR' e
          -- null quando pais e null, e "null OR false" e null, nao false; sem
          -- o coalesce, uma conta so com idioma "en" (nem pais nem portugues)
          -- ordenava null no ORDER BY DESC, que o Postgres poe antes de
          -- true/false por padrao (sem NULLS LAST nesta parte), furando a fila
          -- na frente de conta brasileira de verdade.
          ORDER BY
            COALESCE(c.pais = 'BR' OR c.idioma_principal IN ('pt', 'pt-BR'), false) DESC,
            c.taxa_fora_da_curva DESC NULLS LAST
        ) AS posicao
      FROM contas c
      JOIN candidatas cd ON cd.conta_id = c.id
      -- Semente nunca conta no teto de 50 por nicho e plataforma (item 2): e escolha de gente, o ranking e da maquina.
      -- Idioma "outro" nunca e vigiada (V2b, item 7): fora do ranking desde o WHERE, nao so perde posicao.
      WHERE c.origem <> 'curadoria' AND c.idioma_principal IS DISTINCT FROM 'outro'
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
