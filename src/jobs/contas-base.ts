/**
 * Job `contas-base` (E6 parte 3, item 5): a coleta por termo (hashtag) traz
 * so 1 a 2 vídeos por conta, então a maioria nunca chega aos 5 vídeos que
 * `pontuar.ts` exige para uma mediana de verdade. Este job faz o catch-up:
 * por nicho e por dia, pega as 30 contas que ainda não têm base (menos de
 * `MINIMO_VIDEOS_MEDIANA` vídeos nos últimos 90 dias, com pelo menos 1 vídeo
 * para priorizar por views) e busca até 10 vídeos recentes de cada. Roda
 * antes de `pontuar` na agenda, para a mediana de hoje já contar com o que
 * este job trouxe de manhã.
 *
 * YouTube por `playlistItems` do canal (mesmo par de chamadas de
 * `coleta-youtube.ts`); TikTok e Instagram pelo mesmo ator do `apify-api.ts`,
 * em modo perfil (`buscarTiktok`/`buscarInstagram` com só um handle no
 * array de perfis, sem hashtag: o mesmo mecanismo que já busca as contas
 * vigiadas). O teto diário do Apify é a única trava do TikTok e do
 * Instagram (decisão do `PROXIMO.md`): ao bater, o job pula só as
 * candidatas dessas duas plataformas (ajuste da revisão do PR #34, item
 * 0b: antes o job inteiro parava, e as candidatas do YouTube que vinham
 * depois na lista nunca recebiam catch-up nenhum enquanto o Apify
 * estivesse pausado) e continua tentando as do YouTube, no nicho atual e
 * nos seguintes; `tetoAtingido` no resumo registra que isso aconteceu.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { consumoApi, contas, nichos } from "@/db/schema";
import { config, hojeISO } from "@/lib/config";
import { normalizarVideoInstagram } from "@/servicos/normalizadores/instagram";
import { normalizarVideoTiktok } from "@/servicos/normalizadores/tiktok";
import { normalizarVideoYoutube } from "@/servicos/normalizadores/youtube";

import { buscarInstagram, buscarTiktok } from "./apify-api";
import { upsertConta, upsertVideo } from "./coleta-comum";
import { ErroColeta } from "./execucoes";
import { MINIMO_VIDEOS_MEDIANA } from "./pontuar";
import { buscarCanal, buscarUploadsDoCanal, buscarVideosPorId, CUSTO_LISTA } from "./youtube-api";

const CONTAS_POR_NICHO_POR_DIA = 30;
const VIDEOS_POR_CONTA = 10;
const FONTE_APIFY = "apify";
const FONTE_YOUTUBE = "youtube";

type ContaCandidata = { contaId: number; plataforma: "youtube" | "tiktok" | "instagram"; handle: string };

async function contasCandidatas(nichoId: number): Promise<ContaCandidata[]> {
  const linhas = await db().execute<{ conta_id: number; plataforma: "youtube" | "tiktok" | "instagram"; handle: string }>(sql`
    SELECT c.id AS conta_id, c.plataforma, c.handle
    FROM contas c
    JOIN videos v ON v.conta_id = c.id AND v.publicado_em >= now() - interval '90 days'
    WHERE c.nicho_id = ${nichoId}
      AND c.base_completa_em IS NULL
    GROUP BY c.id, c.plataforma, c.handle
    HAVING count(v.id) < ${MINIMO_VIDEOS_MEDIANA}
    ORDER BY max(v.views) DESC
    LIMIT ${CONTAS_POR_NICHO_POR_DIA}
  `);
  return linhas.rows.map((l) => ({ contaId: l.conta_id, plataforma: l.plataforma, handle: l.handle }));
}

async function consumoDeHoje(fonte: string): Promise<number> {
  const [linha] = await db()
    .select({ unidades: consumoApi.unidades })
    .from(consumoApi)
    .where(and(eq(consumoApi.fonte, fonte), eq(consumoApi.data, hojeISO())));
  return linha?.unidades ?? 0;
}

async function registrarConsumo(fonte: string, unidades: number): Promise<void> {
  if (unidades === 0) return;
  await db()
    .insert(consumoApi)
    .values({ fonte, data: hojeISO(), unidades })
    .onConflictDoUpdate({
      target: [consumoApi.fonte, consumoApi.data],
      set: { unidades: sql`${consumoApi.unidades} + ${unidades}`, atualizadoEm: new Date() },
    });
}

async function marcarBaseCompleta(contaId: number): Promise<void> {
  await db().update(contas).set({ baseCompletaEm: new Date() }).where(eq(contas.id, contaId));
}

/**
 * `usadosApify` e o que de fato conta para `consumo_api` e para o teto (o
 * mesmo `itens.length`, ja cortado, que `coleta-apify.ts` usa: decisao 4
 * da etapa 6, "o teto e o que processamos"); `devolvidosApify` e so
 * telemetria, o bruto do Apify antes do corte (ajuste da revisao do PR
 * #34, item 0c: antes este job registrava `devolvidos` como consumo, uma
 * regua diferente da coleta).
 */
type ResultadoCatchUp = { novos: number; atualizados: number; usadosApify: number; devolvidosApify: number };

async function catchUpTiktok(nichoId: number, candidata: ContaCandidata): Promise<ResultadoCatchUp> {
  const { itens, devolvidos } = await buscarTiktok([], [candidata.handle], VIDEOS_POR_CONTA);
  await registrarConsumo(FONTE_APIFY, itens.length);

  let novos = 0;
  let atualizados = 0;
  for (const item of itens) {
    const normalizado = normalizarVideoTiktok(item);
    if (!normalizado) continue;
    const { video, conta, audio } = normalizado;
    const contaId = await upsertConta(conta, nichoId);
    const resultado = await upsertVideo(video, contaId, nichoId, audio);
    if (resultado === "novo") novos += 1;
    else atualizados += 1;
  }
  return { novos, atualizados, usadosApify: itens.length, devolvidosApify: devolvidos };
}

async function catchUpInstagram(nichoId: number, candidata: ContaCandidata): Promise<ResultadoCatchUp> {
  const { itens, devolvidos } = await buscarInstagram([], [candidata.handle], VIDEOS_POR_CONTA);
  await registrarConsumo(FONTE_APIFY, itens.length);

  let novos = 0;
  let atualizados = 0;
  for (const item of itens) {
    const { video, conta, audio } = normalizarVideoInstagram(item);
    const contaId = await upsertConta(conta, nichoId);
    const resultado = await upsertVideo(video, contaId, nichoId, audio);
    if (resultado === "novo") novos += 1;
    else atualizados += 1;
  }
  return { novos, atualizados, usadosApify: itens.length, devolvidosApify: devolvidos };
}

/**
 * `playlistItems` já devolve do mais novo para o mais antigo (mesma
 * suposição de `coleta-youtube.ts`); os 10 primeiros da fixture de uploads
 * são os 10 mais recentes. Sem trava de cota (o teto diário do Apify é a
 * única trava do job, decisão do `PROXIMO.md`); o custo por conta (3
 * chamadas de 1 unidade) é desprezível contra a cota de 9000 do dia.
 */
async function catchUpYoutube(nichoId: number, candidata: ContaCandidata): Promise<ResultadoCatchUp> {
  await registrarConsumo(FONTE_YOUTUBE, CUSTO_LISTA);
  const canalResp = await buscarCanal(candidata.handle);
  const canal = canalResp.items?.[0];
  if (!canal) return { novos: 0, atualizados: 0, usadosApify: 0, devolvidosApify: 0 };

  await registrarConsumo(FONTE_YOUTUBE, CUSTO_LISTA);
  const uploadsResp = await buscarUploadsDoCanal(canal.contentDetails.relatedPlaylists.uploads);
  const ids = (uploadsResp.items ?? []).slice(0, VIDEOS_POR_CONTA).map((item) => item.snippet.resourceId.videoId);
  if (ids.length === 0) return { novos: 0, atualizados: 0, usadosApify: 0, devolvidosApify: 0 };

  await registrarConsumo(FONTE_YOUTUBE, CUSTO_LISTA);
  const videosResp = await buscarVideosPorId(ids);

  let novos = 0;
  let atualizados = 0;
  for (const item of videosResp.items ?? []) {
    const { video, conta } = normalizarVideoYoutube(item);
    const contaId = await upsertConta(conta, nichoId);
    const resultado = await upsertVideo(video, contaId, nichoId);
    if (resultado === "novo") novos += 1;
    else atualizados += 1;
  }
  return { novos, atualizados, usadosApify: 0, devolvidosApify: 0 };
}

export async function rodarContasBase(): Promise<Record<string, unknown>> {
  const nichosAtivos = await db().select().from(nichos).where(eq(nichos.ativo, true));

  const teto = config.coleta.apifyMaxResultadosDia;
  let resultadosApifyUsados = await consumoDeHoje(FONTE_APIFY);
  let resultadosApifyDevolvidos = 0;
  const apifyCabe = () => resultadosApifyUsados < teto;

  let contasProcessadas = 0;
  let videosNovos = 0;
  let videosAtualizados = 0;
  let tetoAtingido = false;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    const candidatas = await contasCandidatas(nicho.id);
    for (const candidata of candidatas) {
      if ((candidata.plataforma === "tiktok" || candidata.plataforma === "instagram") && !apifyCabe()) {
        tetoAtingido = true;
        continue;
      }

      try {
        const resultado =
          candidata.plataforma === "tiktok"
            ? await catchUpTiktok(nicho.id, candidata)
            : candidata.plataforma === "instagram"
              ? await catchUpInstagram(nicho.id, candidata)
              : await catchUpYoutube(nicho.id, candidata);

        resultadosApifyUsados += resultado.usadosApify;
        resultadosApifyDevolvidos += resultado.devolvidosApify;
        videosNovos += resultado.novos;
        videosAtualizados += resultado.atualizados;
        await marcarBaseCompleta(candidata.contaId);
        contasProcessadas += 1;
      } catch (erro) {
        erros.push(
          `${candidata.plataforma} "${candidata.handle}": ${erro instanceof Error ? erro.message : String(erro)}`,
        );
      }
    }
  }

  if (nichosAtivos.length === 0) {
    throw new ErroColeta("nenhum nicho ativo para o job contas-base", false);
  }

  return {
    nichos: nichosAtivos.length,
    contasProcessadas,
    videosNovos,
    videosAtualizados,
    resultadosApifyDevolvidos,
    tetoAtingido,
    erros: erros.length > 0 ? erros : undefined,
  };
}
