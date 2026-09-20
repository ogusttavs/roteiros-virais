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

/** Tambem usado por `contas-base.ts` (E6 parte 3, item 5): mesmo corte de "ainda sem base". */
export const MINIMO_VIDEOS_MEDIANA = 5;
const MINIMO_VIDEOS_MEDIANA_VELOCIDADE = 3;
/** V2b, item 4: menos que isso, `idioma_principal` fica nulo (sem evidencia suficiente, nunca chuta). */
const MINIMO_VIDEOS_IDIOMA_PRINCIPAL = 3;
const NOVENTA_DIAS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Substituto de terceiro nível, quando a conta não tem mediana própria (menos
 * de 5 vídeos) nem seguidores cadastrados (decisão de 07/09, 16:20,
 * `PROXIMO.md` E6 parte 3, item 2): a mediana de views de todo o nicho
 * naquela plataforma, nos últimos 90 dias, sem olhar de qual conta cada
 * vídeo veio. É o que faz o estoque parado (conta nova, sem seguidor
 * gravado) entrar no motor em vez de ficar sem múltiplo para sempre.
 */
async function passo1MedianaPorConta() {
  return db().execute(sql`
    UPDATE contas c
    SET
      base_fraca = COALESCE(a.n, 0) < ${MINIMO_VIDEOS_MEDIANA},
      mediana_views = CASE
        WHEN COALESCE(a.n, 0) >= ${MINIMO_VIDEOS_MEDIANA} THEN a.mediana_views
        WHEN a.mediana_substituta IS NOT NULL THEN a.mediana_substituta
        WHEN s.mediana_setor IS NOT NULL THEN s.mediana_setor
        ELSE NULL
      END,
      mediana_origem = CASE
        WHEN COALESCE(a.n, 0) >= ${MINIMO_VIDEOS_MEDIANA} THEN 'conta'
        WHEN a.mediana_substituta IS NOT NULL THEN 'seguidores'
        WHEN s.mediana_setor IS NOT NULL THEN 'setor'
        ELSE NULL
      END
    FROM (
      SELECT
        c2.id AS conta_id,
        c2.nicho_id,
        c2.plataforma,
        count(v.id) AS n,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY v.views) AS mediana_views,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY v.views::numeric / NULLIF(c2.seguidores, 0) * ${FATOR_SUBSTITUTO_BASE_FRACA}
        ) AS mediana_substituta
      FROM contas c2
      LEFT JOIN videos v ON v.conta_id = c2.id AND v.publicado_em >= now() - interval '90 days'
      GROUP BY c2.id
    ) a
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
    contasComMediana: r1.rowCount ?? 0,
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
