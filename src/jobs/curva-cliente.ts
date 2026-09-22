/**
 * Job `curva-cliente` (etapa 15, parte 1; V8, itens 1 e 2): mede views,
 * curtidas e comentarios dos videos que os clientes postaram, na cadencia de
 * `src/servicos/curva.ts` (1h nas primeiras 24h, 6h ate 72h, 24h ate 30
 * dias). YouTube pela Data API (`videos.list`, sem OAuth, estatistica
 * publica). TikTok continua pelo Apify por URL do video especifico
 * (confirmado rodando com chave real em 05/09/2026, ver `apify-api.ts`),
 * dentro do teto diario que a coleta ja usa (mesma fonte "apify" em
 * `consumo_api`, decisao do PROXIMO.md: "Apify por cliente" soma no mesmo
 * teto do "Apify por nicho").
 *
 * Instagram passa a preferir a Graph API da Meta, de graca, quando o cliente
 * tem `clientes.meta_ig_id` resolvido (`meta-ig-cliente.ts`, opportunista
 * aqui tambem, na primeira medicao de um cliente sem id ainda): lista a
 * midia da propria conta (`buscarMediaDaConta`), casa o codigo curto do
 * permalink com o `idExterno` do video, guarda o id da midia
 * (`videos_cliente.meta_media_id`) e, dai em diante, le so essa midia
 * (`buscarMediaPorId`, uma chamada). Sem `meta_ig_id`, ou se a Meta falhar
 * (conta, token ou limite), cai para o Apify por URL, como sempre: nunca
 * derruba o job, so registra no resumo (`medidosInstagramMeta` e
 * `medidosInstagramApify`). Um erro de token ou de limite (afeta TODAS as
 * contas, nao uma so) para a Meta pelo resto desta rodada, para nao repetir
 * o mesmo erro em cada cliente.
 *
 * Post do Instagram sem video (foto ou carrossel) volta visualizacao nula em
 * qualquer uma das duas fontes; `gravarMetrica` grava `views: 0` nesse caso,
 * curtidas e comentarios continuam corretos (achado da verificacao original
 * do Apify, 05/09/2026).
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { clientes, consumoApi, metricasVideoCliente, videosCliente, type FonteMedida } from "@/db/schema";
import { config, hojeISO } from "@/lib/config";
import { estaNaHoraDeMedir, shortcodeDoPermalink, videosParaMedir, type VideoParaMedir } from "@/servicos/curva";
import { resolverMetaIgId } from "@/servicos/meta-ig-cliente";

import { buscarInstagramPorUrl, buscarTiktokPorUrl } from "./apify-api";
import { buscarMediaDaConta, buscarMediaPorId, ErroMetaApi, erroMetaEhTokenOuLimite, type MetaMediaItem } from "./meta-api";
import { buscarVideosPorId, CUSTO_LISTA } from "./youtube-api";

const FONTE_YOUTUBE = "youtube";
const FONTE_APIFY = "apify";
const FONTE_META = "meta";

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

async function gravarMetrica(
  video: VideoParaMedir,
  medidas: { views: number; likes: number; comentarios: number },
  agora: Date,
  fonte: FonteMedida,
  metaMediaId?: string,
): Promise<void> {
  await db().insert(metricasVideoCliente).values({
    videoClienteId: video.id,
    coletadoEm: agora,
    views: medidas.views,
    likes: medidas.likes,
    comentarios: medidas.comentarios,
    fonte,
  });
  await db()
    .update(videosCliente)
    .set(metaMediaId ? { ultimaColeta: agora, metaMediaId } : { ultimaColeta: agora })
    .where(eq(videosCliente.id, video.id));
}

async function medirYoutube(videos: VideoParaMedir[], agora: Date, erros: string[]): Promise<number> {
  let medidos = 0;
  for (let i = 0; i < videos.length; i += 50) {
    const lote = videos.slice(i, i + 50);
    try {
      const resposta = await buscarVideosPorId(lote.map((v) => v.idExterno));
      await registrarConsumo(FONTE_YOUTUBE, CUSTO_LISTA);
      const porId = new Map((resposta.items ?? []).map((item) => [item.id, item]));
      for (const video of lote) {
        const item = porId.get(video.idExterno);
        if (!item) {
          erros.push(`youtube ${video.idExterno}: nao encontrado (video apagado ou privado)`);
          continue;
        }
        await gravarMetrica(
          video,
          {
            views: Number(item.statistics.viewCount ?? 0),
            likes: Number(item.statistics.likeCount ?? 0),
            comentarios: Number(item.statistics.commentCount ?? 0),
          },
          agora,
          FONTE_YOUTUBE,
        );
        medidos += 1;
      }
    } catch (erro) {
      erros.push(`youtube lote a partir de ${i}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
  return medidos;
}

async function medirTiktok(videos: VideoParaMedir[], agora: Date, erros: string[]): Promise<number> {
  let medidos = 0;
  const teto = config.coleta.apifyMaxResultadosDia;
  let usados = await consumoDeHoje(FONTE_APIFY);

  for (const video of videos) {
    if (usados >= teto) {
      erros.push(`tiktok ${video.idExterno}: teto diario do apify atingido, tenta na proxima hora`);
      continue;
    }
    try {
      const {
        itens: [item],
      } = await buscarTiktokPorUrl([`https://www.tiktok.com/@x/video/${video.idExterno}`]);
      usados += 1;
      await registrarConsumo(FONTE_APIFY, 1);
      if (!item) {
        erros.push(`tiktok ${video.idExterno}: nao encontrado (video apagado ou privado)`);
        continue;
      }
      await gravarMetrica(
        video,
        { views: item.playCount ?? 0, likes: item.diggCount ?? 0, comentarios: item.commentCount ?? 0 },
        agora,
        FONTE_APIFY,
      );
      medidos += 1;
    } catch (erro) {
      erros.push(`tiktok ${video.idExterno}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
  return medidos;
}

/** Mede pelo Apify por URL, como sempre: quem chega aqui e quem nao tem `meta_ig_id`, ou a Meta nao achou/falhou (V8). */
async function medirInstagramApify(videos: VideoParaMedir[], agora: Date, erros: string[]): Promise<number> {
  let medidos = 0;
  const teto = config.coleta.apifyMaxResultadosDia;
  let usados = await consumoDeHoje(FONTE_APIFY);

  for (const video of videos) {
    if (usados >= teto) {
      erros.push(`instagram ${video.idExterno}: teto diario do apify atingido, tenta na proxima hora`);
      continue;
    }
    try {
      const url = `https://www.instagram.com/reel/${video.idExterno}/`;
      const {
        itens: [item],
      } = await buscarInstagramPorUrl([url]);
      usados += 1;
      await registrarConsumo(FONTE_APIFY, 1);
      if (!item) {
        erros.push(`instagram ${video.idExterno}: nao encontrado (video apagado ou privado)`);
        continue;
      }
      await gravarMetrica(
        video,
        { views: item.videoViewCount ?? 0, likes: item.likesCount ?? 0, comentarios: item.commentsCount ?? 0 },
        agora,
        FONTE_APIFY,
      );
      medidos += 1;
    } catch (erro) {
      erros.push(`instagram ${video.idExterno}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
  return medidos;
}

type ResultadoInstagramMeta = { medidos: number; restantes: VideoParaMedir[]; indisponivel: boolean };

/**
 * Mede a Instagram de UM cliente pela Graph API da Meta (V8, item 2). Devolve
 * os que nao deu para medir por essa via (`restantes`, seguem para o
 * Apify) e `indisponivel` quando o motivo foi token vencido ou limite de
 * taxa: quem chama para de tentar a Meta pelo resto da rodada (o erro afeta
 * todas as contas, nao so esta).
 */
async function medirInstagramMeta(
  videos: VideoParaMedir[],
  igId: string,
  agora: Date,
  erros: string[],
): Promise<ResultadoInstagramMeta> {
  const semMediaId = videos.filter((v) => !v.metaMediaId);
  const comMediaId = videos.filter((v) => v.metaMediaId);
  const restantes: VideoParaMedir[] = [];
  let medidos = 0;

  if (semMediaId.length > 0) {
    let midiaPorCodigo: Map<string, MetaMediaItem> | null = null;
    try {
      const midias = await buscarMediaDaConta(igId);
      midiaPorCodigo = new Map();
      for (const item of midias) {
        const codigo = item.permalink ? shortcodeDoPermalink(item.permalink) : null;
        if (codigo) midiaPorCodigo.set(codigo, item);
      }
    } catch (erro) {
      if (erro instanceof ErroMetaApi && erroMetaEhTokenOuLimite(erro)) {
        erros.push(`instagram (meta) listar midia da conta ${igId}: token ou limite atingido: ${erro.message}`);
        return { medidos: 0, restantes: videos, indisponivel: true };
      }
      erros.push(`instagram (meta) listar midia da conta ${igId}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }

    for (const video of semMediaId) {
      const item = midiaPorCodigo?.get(video.idExterno);
      if (!item) {
        restantes.push(video);
        continue;
      }
      await gravarMetrica(
        video,
        { views: item.total_views_count ?? 0, likes: item.like_count ?? 0, comentarios: item.comments_count ?? 0 },
        agora,
        FONTE_META,
        item.id,
      );
      medidos += 1;
    }
  }

  for (let i = 0; i < comMediaId.length; i += 1) {
    const video = comMediaId[i];
    try {
      const item = await buscarMediaPorId(video.metaMediaId!);
      await gravarMetrica(
        video,
        { views: item.total_views_count ?? 0, likes: item.like_count ?? 0, comentarios: item.comments_count ?? 0 },
        agora,
        FONTE_META,
      );
      medidos += 1;
    } catch (erro) {
      if (erro instanceof ErroMetaApi && erroMetaEhTokenOuLimite(erro)) {
        erros.push(`instagram (meta) ${video.idExterno}: token ou limite atingido: ${erro.message}`);
        restantes.push(...comMediaId.slice(i));
        return { medidos, restantes, indisponivel: true };
      }
      erros.push(`instagram (meta) ${video.idExterno}: ${erro instanceof Error ? erro.message : String(erro)}`);
      restantes.push(video);
    }
  }

  return { medidos, restantes, indisponivel: false };
}

/**
 * Orquestra o Instagram de todos os clientes devidos (V8, itens 1 e 2): um
 * cliente por vez, Meta primeiro quando tem (ou consegue) `meta_ig_id`,
 * Apify no que sobrar. `metaIndisponivel` para de tentar a Meta assim que um
 * erro de token ou de limite acontecer, pelo resto desta chamada.
 */
async function medirInstagram(videos: VideoParaMedir[], agora: Date, erros: string[]): Promise<{ medidosMeta: number; medidosApify: number }> {
  if (videos.length === 0) return { medidosMeta: 0, medidosApify: 0 };

  let metaIndisponivel = !config.coleta.metaAtivo;
  const porCliente = new Map<number, VideoParaMedir[]>();
  for (const video of videos) {
    if (!porCliente.has(video.clienteId)) porCliente.set(video.clienteId, []);
    porCliente.get(video.clienteId)!.push(video);
  }

  const clienteIds = [...porCliente.keys()];
  const idsJaResolvidos = metaIndisponivel
    ? new Map<number, string | null>()
    : new Map(
        (await db().select({ id: clientes.id, metaIgId: clientes.metaIgId }).from(clientes).where(inArray(clientes.id, clienteIds))).map(
          (c) => [c.id, c.metaIgId],
        ),
      );

  let medidosMeta = 0;
  const restantesParaApify: VideoParaMedir[] = [];

  for (const [clienteId, videosDoCliente] of porCliente) {
    if (metaIndisponivel) {
      restantesParaApify.push(...videosDoCliente);
      continue;
    }

    let igId: string | null;
    try {
      igId = idsJaResolvidos.get(clienteId) ?? (await resolverMetaIgId(clienteId));
    } catch (erro) {
      // `resolverMetaIgId` so relanca erro de token ou de limite (afeta todos os clientes, nao so este).
      erros.push(`instagram (meta) resolver a conta do cliente ${clienteId}: token ou limite atingido: ${erro instanceof Error ? erro.message : String(erro)}`);
      metaIndisponivel = true;
      restantesParaApify.push(...videosDoCliente);
      continue;
    }
    if (!igId) {
      restantesParaApify.push(...videosDoCliente);
      continue;
    }

    const resultado = await medirInstagramMeta(videosDoCliente, igId, agora, erros);
    medidosMeta += resultado.medidos;
    restantesParaApify.push(...resultado.restantes);
    if (resultado.indisponivel) metaIndisponivel = true;
  }

  const medidosApify = await medirInstagramApify(restantesParaApify, agora, erros);
  return { medidosMeta, medidosApify };
}

export async function rodarCurvaCliente(agora = new Date()): Promise<Record<string, unknown>> {
  const candidatos = await videosParaMedir(agora);
  const devidos = candidatos.filter((v) => estaNaHoraDeMedir(v.postadoEm, v.ultimaColeta, agora));

  const porPlataforma = {
    youtube: devidos.filter((v) => v.plataforma === "youtube"),
    tiktok: devidos.filter((v) => v.plataforma === "tiktok"),
    instagram: devidos.filter((v) => v.plataforma === "instagram"),
  };

  const erros: string[] = [];
  const medidosYoutube = await medirYoutube(porPlataforma.youtube, agora, erros);
  const medidosTiktok = await medirTiktok(porPlataforma.tiktok, agora, erros);
  const { medidosMeta: medidosInstagramMeta, medidosApify: medidosInstagramApify } = await medirInstagram(
    porPlataforma.instagram,
    agora,
    erros,
  );

  return {
    candidatos: candidatos.length,
    devidos: devidos.length,
    medidosYoutube,
    medidosTiktok,
    medidosInstagramMeta,
    medidosInstagramApify,
    erros: erros.length > 0 ? erros : undefined,
  };
}
