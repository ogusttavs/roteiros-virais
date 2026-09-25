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
 * 1. mediana de views por conta (+ `base_fraca` e `mediana_origem`)
 * 2. fora_da_curva por vídeo
 * 3. velocidade por vídeo (só 2 a 7 dias)
 * 4. mediana de velocidade por conta (2 a 30 dias, calculada direto da
 *    fórmula bruta, não da coluna `velocidade`, porque essa coluna só é
 *    preenchida na janela mais estreita de 2 a 7 dias) e velocidade_relativa
 *    por vídeo
 * 5. taxa_fora_da_curva por conta (só conta vídeo com `fora_da_curva` calculado, no
 *    numerador e no denominador; conta sem nenhum vídeo pontuado fica com taxa nula,
 *    não zero, ajuste da revisão da etapa 7 no `PROXIMO.md` da etapa 8)
 * 6. idioma_principal por conta (V2b, item 4, escopo 5.11: o Brasil primeiro)
 * 7. pais por conta, a partir do idioma_principal (mesmo item)
 */
import { and, eq, gte, isNull, sql } from "drizzle-orm";

import { temIndicioDeBrasil } from "@/config/brasil";
import { db } from "@/db";
import { contas, videos } from "@/db/schema";
import { config } from "@/lib/config";

/** Tambem usado por `contas-base.ts` (E6 parte 3, item 5): mesmo corte de "ainda sem base". */
export const MINIMO_VIDEOS_MEDIANA = 5;
const MINIMO_VIDEOS_MEDIANA_VELOCIDADE = 3;
/** V2b, item 4: menos que isso, `idioma_principal` fica nulo (sem evidencia suficiente, nunca chuta). */
const MINIMO_VIDEOS_IDIOMA_PRINCIPAL = 3;
const NOVENTA_DIAS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Uma linha por conta, nos ultimos 90 dias: quantos videos entraram na
 * janela e a mediana de views deles (nula sem nenhum video). Reaproveitada
 * pelas duas consultas de `passo1MedianaPorConta` (o relatorio da taxa
 * tipica e o UPDATE de verdade), para as duas nunca divergirem.
 */
const porContaComMediana = sql`
  SELECT
    c2.id AS conta_id,
    c2.nicho_id,
    c2.plataforma,
    c2.seguidores,
    count(v.id) AS n,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY v.views) AS mediana_views
  FROM contas c2
  LEFT JOIN videos v ON v.conta_id = c2.id AND v.publicado_em >= now() - interval '90 days'
  GROUP BY c2.id
`;

/**
 * A taxa tipica "views por seguidor" de um nicho e uma plataforma: mediana
 * de `mediana_views / seguidores` entre as contas que TEM mediana propria
 * (`MINIMO_VIDEOS_MEDIANA` ou mais videos na janela) e seguidores
 * cadastrados. E o segundo nivel do substituto de conta com base fraca.
 */
const taxaTipicaPorNichoEPlataforma = sql`
  SELECT
    nicho_id,
    plataforma,
    count(*) AS contas,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY mediana_views / NULLIF(seguidores, 0)) AS taxa
  FROM (${porContaComMediana}) por_conta
  WHERE n >= ${MINIMO_VIDEOS_MEDIANA} AND seguidores IS NOT NULL AND seguidores > 0
  GROUP BY nicho_id, plataforma
`;

export type TaxaSubstituta = { nichoId: number; plataforma: string; taxa: number; contas: number };

/**
 * V9d, item 0b (achado do Gustavo em 25/09, usando o painel): a formula
 * antiga do substituto de terceiro nivel (`views do video / seguidores *
 * 100`, mediana entre as poucas amostras da propria conta) tinha um bug com
 * base fraca de 1 video so, o caso mais comum: `fora_da_curva = views /
 * mediana = views / (views/seguidores*100) = seguidores/100`, o multiplo
 * so dependia dos seguidores, nunca das views de verdade. Uma conta de 319
 * mil seguidores com um unico video de 837 views virava 3.219x "fora da
 * curva" sozinha, so pelo tamanho da conta.
 *
 * Formula nova: `seguidores * taxa tipica do nicho e da plataforma`
 * (`taxaTipicaPorNichoEPlataforma`, acima), a mediana de "views por
 * seguidor" entre as contas que JA TEM mediana propria naquele nicho e
 * plataforma. Sem nenhuma conta com mediana propria ali (taxa tipica
 * nula), cai para o terceiro nivel que ja existia, a mediana do setor.
 * `mediana_origem` continua "seguidores" para este segundo nivel: so a
 * conta por tras do numero mudou, o nome da origem nao.
 */
async function passo1MedianaPorConta(): Promise<{ atualizadas: number; taxasSubstitutas: TaxaSubstituta[] }> {
  const taxas = await db().execute<{ nicho_id: number; plataforma: string; taxa: string; contas: string }>(sql`
    ${taxaTipicaPorNichoEPlataforma}
  `);

  const resultado = await db().execute(sql`
    UPDATE contas c
    SET
      base_fraca = COALESCE(a.n, 0) < ${MINIMO_VIDEOS_MEDIANA},
      mediana_views = CASE
        WHEN COALESCE(a.n, 0) >= ${MINIMO_VIDEOS_MEDIANA} THEN a.mediana_views
        WHEN t.taxa IS NOT NULL AND c.seguidores IS NOT NULL AND c.seguidores > 0 THEN c.seguidores * t.taxa
        WHEN s.mediana_setor IS NOT NULL THEN s.mediana_setor
        ELSE NULL
      END,
      mediana_origem = CASE
        WHEN COALESCE(a.n, 0) >= ${MINIMO_VIDEOS_MEDIANA} THEN 'conta'
        WHEN t.taxa IS NOT NULL AND c.seguidores IS NOT NULL AND c.seguidores > 0 THEN 'seguidores'
        WHEN s.mediana_setor IS NOT NULL THEN 'setor'
        ELSE NULL
      END
    FROM (${porContaComMediana}) a
    LEFT JOIN (${taxaTipicaPorNichoEPlataforma}) t ON t.nicho_id = a.nicho_id AND t.plataforma = a.plataforma
    LEFT JOIN (
      SELECT
        nicho_id,
        plataforma,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY views) AS mediana_setor
      FROM videos
      WHERE publicado_em >= now() - interval '90 days'
      GROUP BY nicho_id, plataforma
    ) s ON s.nicho_id = a.nicho_id AND s.plataforma = a.plataforma
    WHERE c.id = a.conta_id
  `);

  return {
    atualizadas: resultado.rowCount ?? 0,
    taxasSubstitutas: taxas.rows.map((linha) => ({
      nichoId: Number(linha.nicho_id),
      plataforma: String(linha.plataforma),
      taxa: Number(linha.taxa),
      contas: Number(linha.contas),
    })),
  };
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
        -- V9d, item 0b: o piso vem antes do múltiplo, também para a lista de vigilância (o ranking usa
        -- esta taxa); um vídeo abaixo do piso nunca conta como "acima" da curva.
        count(v.id) FILTER (
          WHERE v.fora_da_curva >= ${config.regras.limiarForaDaCurva}
            AND v.views >= ${config.regras.pisoViewsReferencia}
        ) AS acima
      FROM contas c2
      LEFT JOIN videos v ON v.conta_id = c2.id
        AND v.publicado_em >= now() - interval '90 days'
        AND v.fora_da_curva IS NOT NULL
      GROUP BY c2.id
    ) a
    WHERE c.id = a.conta_id
  `);
}

/**
 * Moda do `idioma` dos videos da conta nos ultimos 90 dias (V2b, item 4),
 * so quando houver pelo menos `MINIMO_VIDEOS_IDIOMA_PRINCIPAL` com idioma
 * conhecido; senao fica nulo (a janela pode ter esvaziado desde a ultima
 * vez, "nao sei" e mais correto que um valor velho).
 */
/** Exportado para `scripts/preencher-idioma.ts` (V2b, item 5) reaproveitar sem duplicar a query. */
export async function passo6IdiomaPrincipalPorConta() {
  return db().execute(sql`
    UPDATE contas c
    SET idioma_principal = a.moda
    FROM (
      SELECT
        c2.id AS conta_id,
        CASE
          WHEN count(v.id) >= ${MINIMO_VIDEOS_IDIOMA_PRINCIPAL} THEN mode() WITHIN GROUP (ORDER BY v.idioma)
          ELSE NULL
        END AS moda
      FROM contas c2
      LEFT JOIN videos v ON v.conta_id = c2.id
        AND v.publicado_em >= now() - interval '90 days'
        AND v.idioma IS NOT NULL
      GROUP BY c2.id
    ) a
    WHERE c.id = a.conta_id
  `);
}

/**
 * Pais da conta a partir do idioma principal (V2b, item 4): nunca
 * sobrescreve um pais ja conhecido (o `country` do canal do YouTube,
 * gravado na coleta, `upsertConta`, manda). "pt-BR" ja confirma Brasil
 * sozinho (só a extração em lote grava esse valor, lendo a fala real);
 * "pt" genérico (da detecção por título/descrição, que nunca diferencia
 * Brasil de Portugal) só vira "BR" com um indício de Brasil de verdade em
 * algum vídeo recente da conta (`temIndicioDeBrasil`, mesma heurística que
 * o `meta-hashtags` já usa). Essa segunda parte roda por conta, em JS
 * (não SQL puro como o resto do arquivo): `temIndicioDeBrasil` é lógica de
 * texto, não uma expressão simples de traduzir para SQL, e o universo de
 * contas candidatas (idioma "pt" e pais ainda desconhecido) é pequeno.
 */
/** Exportado para `scripts/preencher-idioma.ts` (V2b, item 5) reaproveitar sem duplicar a query. */
export async function passo7PaisPorIdiomaPrincipal(): Promise<number> {
  const direto = await db().execute(sql`
    UPDATE contas SET pais = 'BR'
    WHERE pais IS NULL AND idioma_principal = 'pt-BR'
  `);

  const candidatas = await db()
    .select({ id: contas.id })
    .from(contas)
    .where(and(isNull(contas.pais), eq(contas.idiomaPrincipal, "pt")));

  let porIndicio = 0;
  for (const candidata of candidatas) {
    const videosRecentes = await db()
      .select({ titulo: videos.titulo, descricao: videos.descricao })
      .from(videos)
      .where(and(eq(videos.contaId, candidata.id), gte(videos.publicadoEm, new Date(Date.now() - NOVENTA_DIAS_MS))));

    const temIndicio = videosRecentes.some((v) => temIndicioDeBrasil(`${v.titulo ?? ""} ${v.descricao ?? ""}`));
    if (temIndicio) {
      await db().update(contas).set({ pais: "BR" }).where(eq(contas.id, candidata.id));
      porIndicio += 1;
    }
  }

  return (direto.rowCount ?? 0) + porIndicio;
}

export async function rodarPontuar(): Promise<Record<string, unknown>> {
  const r1 = await passo1MedianaPorConta();
  const r2 = await passo2ForaDaCurvaPorVideo();
  const r3 = await passo3VelocidadePorVideo();
  const r4 = await passo4VelocidadeRelativa();
  const r5 = await passo5TaxaForaDaCurvaPorConta();
  const r6 = await passo6IdiomaPrincipalPorConta();
  const r7 = await passo7PaisPorIdiomaPrincipal();

  return {
    contasComMediana: r1.atualizadas,
    /** V9d, item 0b: a taxa "views por seguidor" usada no segundo nivel do substituto, por nicho e plataforma. */
    taxasSubstitutas: r1.taxasSubstitutas,
    videosComForaDaCurva: r2.rowCount ?? 0,
    videosComVelocidade: r3.rowCount ?? 0,
    videosComVelocidadeRelativa: r4.rowCount ?? 0,
    contasComTaxa: r5.rowCount ?? 0,
    contasComIdiomaPrincipal: r6.rowCount ?? 0,
    contasComPaisPorIdioma: r7,
  };
}

/**
 * Passada leve do meio-dia (E6 parte 3, terceira rodada, item 6): so os
 * passos 3 e 4 (velocidade por video, mediana e velocidade relativa por
 * conta). Sem os passos 1, 2 e 5 (mediana de views, fora_da_curva, taxa por
 * conta), que sao a conta cara e nao mudam entre a rodada da madrugada e a
 * do meio-dia: a mediana de views da conta so muda com dado novo do dia
 * anterior, ja processado as 03:45. `rodarColetaMeioDia` chama isto depois
 * da coleta leve, para "subiu 3x hoje de manha" aparecer ainda hoje.
 */
export async function rodarPontuarVelocidade(): Promise<Record<string, unknown>> {
  const r3 = await passo3VelocidadePorVideo();
  const r4 = await passo4VelocidadeRelativa();

  return {
    videosComVelocidade: r3.rowCount ?? 0,
    videosComVelocidadeRelativa: r4.rowCount ?? 0,
  };
}
