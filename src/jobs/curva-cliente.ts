/**
 * Job `curva-cliente` (etapa 15, parte 1): mede views, curtidas e
 * comentarios dos videos que os clientes postaram, na cadencia de
 * `src/servicos/curva.ts` (1h nas primeiras 24h, 6h ate 72h, 24h ate 30
 * dias). YouTube pela Data API (`videos.list`, sem OAuth, estatistica
 * publica); TikTok e Instagram pelo Apify por URL do video especifico
 * (confirmado rodando com chave real em 05/09/2026, ver `apify-api.ts`),
 * dentro do teto diario que a coleta ja usa (mesma fonte "apify" em
 * `consumo_api`, decisao do PROXIMO.md: "Apify por cliente" soma no mesmo
 * teto do "Apify por nicho"). Post do Instagram sem video (foto ou carrossel)
 * volta `videoViewCount` nulo; `medirInstagram` grava `views: 0` nesse caso,
 * curtidas e comentarios continuam corretos (achado da mesma verificacao).
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { consumoApi, metricasVideoCliente, videosCliente } from "@/db/schema";
import { config, hojeISO } from "@/lib/config";
import { estaNaHoraDeMedir, videosParaMedir, type VideoParaMedir } from "@/servicos/curva";

import { buscarInstagramPorUrl, buscarTiktokPorUrl } from "./apify-api";
import { buscarVideosPorId, CUSTO_LISTA } from "./youtube-api";

const FONTE_YOUTUBE = "youtube";
const FONTE_APIFY = "apify";

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
): Promise<void> {
  await db().insert(metricasVideoCliente).values({
    videoClienteId: video.id,
    coletadoEm: agora,
    views: medidas.views,
    likes: medidas.likes,
    comentarios: medidas.comentarios,
  });
  await db().update(videosCliente).set({ ultimaColeta: agora }).where(eq(videosCliente.id, video.id));
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
      const [item] = await buscarTiktokPorUrl([`https://www.tiktok.com/@x/video/${video.idExterno}`]);
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
      );
      medidos += 1;
    } catch (erro) {
      erros.push(`tiktok ${video.idExterno}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
  return medidos;
}

async function medirInstagram(videos: VideoParaMedir[], agora: Date, erros: string[]): Promise<number> {
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
      const [item] = await buscarInstagramPorUrl([url]);
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
      );
      medidos += 1;
    } catch (erro) {
      erros.push(`instagram ${video.idExterno}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
  return medidos;
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
  const medidosInstagram = await medirInstagram(porPlataforma.instagram, agora, erros);

  return {
    candidatos: candidatos.length,
    devidos: devidos.length,
    medidosYoutube,
    medidosTiktok,
    medidosInstagram,
    erros: erros.length > 0 ? erros : undefined,
  };
}
