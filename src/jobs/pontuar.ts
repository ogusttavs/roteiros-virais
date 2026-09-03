/**
 * Job `pontuar` (etapa 7): a matemática que separa pesquisa boa de ruim
 * (escopo 5.1 a 5.3), sem IA. Cinco passos em SQL puro, cada um um
 * `UPDATE ... FROM` (nada de carregar a tabela inteira em memória, decisão
 * do Fable em `PROXIMO.md`). Cada passo usa um `LEFT JOIN` a partir de
 * `contas`, para toda conta ser tocada mesmo sem vídeo nenhum na janela (sem
 * isso, uma conta que caiu fora da janela ficaria com um valor antigo preso
 * para sempre).
 *
 * Ordem (decisão 1 do `PROXIMO.md`, cada passo depende do anterior):
 * 1. mediana de views por conta (+ `base_fraca`)
 * 2. fora_da_curva por vídeo
 * 3. velocidade por vídeo (só 2 a 7 dias)
 * 4. mediana de velocidade por conta (2 a 30 dias, calculada direto da
 *    fórmula bruta, não da coluna `velocidade`, porque essa coluna só é
 *    preenchida na janela mais estreita de 2 a 7 dias) e velocidade_relativa
 *    por vídeo
 * 5. taxa_fora_da_curva por conta
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { config } from "@/lib/config";

/**
 * Fator do substituto de mediana para conta com base fraca (menos de 5
 * vídeos nos últimos 90 dias, decisão 2 do `PROXIMO.md`): mediana de
 * (views do vídeo / seguidores da conta) × este fator, entre as poucas
 * amostras que existirem (1 a 4 vídeos). O fator escala a taxa "views por
 * seguidor" (tipicamente bem menor que 1) para a mesma ordem de grandeza de
 * uma mediana de views normal, para o resto da conta (fora_da_curva,
 * taxa_fora_da_curva) continuar comparável sem tratamento especial. Sem
 * seguidores cadastrados, ou zero vídeo na janela, a mediana fica nula e os
 * vídeos da conta não recebem fora_da_curva (decisão explícita do
 * `PROXIMO.md`).
 */
const FATOR_SUBSTITUTO_BASE_FRACA = 100;

const MINIMO_VIDEOS_MEDIANA = 5;
const MINIMO_VIDEOS_MEDIANA_VELOCIDADE = 3;

async function passo1MedianaPorConta() {
  return db().execute(sql`
    UPDATE contas c
    SET
      base_fraca = COALESCE(a.n, 0) < ${MINIMO_VIDEOS_MEDIANA},
      mediana_views = CASE
        WHEN COALESCE(a.n, 0) >= ${MINIMO_VIDEOS_MEDIANA} THEN a.mediana_views
        WHEN COALESCE(a.n, 0) > 0 THEN a.mediana_substituta
        ELSE NULL
      END
    FROM (
      SELECT
        c2.id AS conta_id,
        count(v.id) AS n,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY v.views) AS mediana_views,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY v.views::numeric / NULLIF(c2.seguidores, 0) * ${FATOR_SUBSTITUTO_BASE_FRACA}
        ) AS mediana_substituta
      FROM contas c2
      LEFT JOIN videos v ON v.conta_id = c2.id AND v.publicado_em >= now() - interval '90 days'
      GROUP BY c2.id
    ) a
    WHERE c.id = a.conta_id
  `);
}

async function passo2ForaDaCurvaPorVideo() {
  return db().execute(sql`
    UPDATE videos v
    SET fora_da_curva = CASE
      WHEN c.mediana_views IS NOT NULL AND c.mediana_views > 0 THEN v.views::numeric / c.mediana_views
      ELSE NULL
    END
    FROM contas c
    WHERE c.id = v.conta_id
  `);
}

async function passo3VelocidadePorVideo() {
  return db().execute(sql`
    UPDATE videos v
    SET velocidade = CASE
      WHEN v.publicado_em IS NOT NULL
        AND v.publicado_em <= now() - interval '2 days'
        AND v.publicado_em >= now() - interval '7 days'
      THEN v.views::numeric / (EXTRACT(EPOCH FROM (now() - v.publicado_em)) / 3600)
      ELSE NULL
    END
  `);
}

async function passo4VelocidadeRelativa() {
  await db().execute(sql`
    UPDATE contas c
    SET mediana_velocidade = CASE
      WHEN COALESCE(a.n, 0) >= ${MINIMO_VIDEOS_MEDIANA_VELOCIDADE} THEN a.mediana
      ELSE NULL
    END
    FROM (
      SELECT
        c2.id AS conta_id,
        count(v.id) AS n,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY v.views::numeric / (EXTRACT(EPOCH FROM (now() - v.publicado_em)) / 3600)
        ) AS mediana
      FROM contas c2
      LEFT JOIN videos v ON v.conta_id = c2.id
        AND v.publicado_em IS NOT NULL
        AND v.publicado_em <= now() - interval '2 days'
        AND v.publicado_em >= now() - interval '30 days'
      GROUP BY c2.id
    ) a
    WHERE c.id = a.conta_id
  `);

  return db().execute(sql`
    UPDATE videos v
    SET velocidade_relativa = CASE
      WHEN v.velocidade IS NOT NULL AND c.mediana_velocidade IS NOT NULL AND c.mediana_velocidade > 0
      THEN v.velocidade / c.mediana_velocidade
      ELSE NULL
    END
    FROM contas c
    WHERE c.id = v.conta_id
  `);
}

async function passo5TaxaForaDaCurvaPorConta() {
  return db().execute(sql`
    UPDATE contas c
    SET taxa_fora_da_curva = CASE
      WHEN COALESCE(a.n, 0) > 0 THEN a.acima::numeric / a.n
      ELSE NULL
    END
    FROM (
      SELECT
        c2.id AS conta_id,
        count(v.id) AS n,
        count(v.id) FILTER (WHERE v.fora_da_curva >= ${config.regras.limiarForaDaCurva}) AS acima
      FROM contas c2
      LEFT JOIN videos v ON v.conta_id = c2.id AND v.publicado_em >= now() - interval '90 days'
      GROUP BY c2.id
    ) a
    WHERE c.id = a.conta_id
  `);
}

export async function rodarPontuar(): Promise<Record<string, unknown>> {
  const r1 = await passo1MedianaPorConta();
  const r2 = await passo2ForaDaCurvaPorVideo();
  const r3 = await passo3VelocidadePorVideo();
  const r4 = await passo4VelocidadeRelativa();
  const r5 = await passo5TaxaForaDaCurvaPorConta();

  return {
    contasComMediana: r1.rowCount ?? 0,
    videosComForaDaCurva: r2.rowCount ?? 0,
    videosComVelocidade: r3.rowCount ?? 0,
    videosComVelocidadeRelativa: r4.rowCount ?? 0,
    contasComTaxa: r5.rowCount ?? 0,
  };
}
