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
 * E19 PR 1: ANTES de tudo isso, a marca que ligou o proprio Instagram (`contas_conectadas`, `servicos/conta-conectada.ts`) e lida pelo acesso dela, com o mesmo molde
 * (lista a midia, casa o codigo curto, guarda o id da midia, depois le so essa midia). O acesso de uma marca nunca le o Instagram de outra: a conta e buscada pelo id da
 * PROPRIA marca de cada video. O que a conta ligada nao mediu cai para o caminho de sempre (o usuario do sistema da V8, depois o Apify). O acesso que a Meta recusa
 * (codigo 190 ou 102) ou sem permissao fica gravado na conta ligada, para a tela dizer e a pessoa ligar de novo; e SO dessa marca: nao para a Meta das outras. Limite do
 * aplicativo (pausa da Meta) continua parando a Meta inteira pelo resto da rodada.
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
import { registrarMarcasPuladas, resumoDasMarcasPuladas, separarMarcasPorAssinatura } from "@/servicos/assinatura-tarefas";
import { contaParaLeitura, erroDaContaPara, registrarErroDaConta, registrarLeituraDaConta } from "@/servicos/conta-conectada";
import { estaNaHoraDeMedir, shortcodeDoPermalink, videosParaMedir, type VideoParaMedir } from "@/servicos/curva";
import { resolverMetaIgId } from "@/servicos/meta-ig-cliente";

import { buscarInstagramPorUrl, buscarTiktokPorUrl } from "./apify-api";
import { definirRamoDoContexto, restaurarRamoDoContexto } from "./contexto-execucao";
import { buscarMediaDaConta, buscarMediaPorId, buscarViewsDaMidia, ErroMetaApi, erroMetaEhTokenOuLimite, type MetaMediaItem, type TokenOuAcesso } from "./meta-api";
import { buscarVideosPorId, CUSTO_LISTA } from "./youtube-api";

const FONTE_YOUTUBE = "youtube";
const FONTE_APIFY = "apify";
const FONTE_META = "meta";

/** O ramo da marca de cada vídeo medido, para o gasto do Apify ser do ramo dela (uma consulta por marca por rodada). */
const ramosPorMarca = new Map<number, number | null>();
async function ramoDaMarca(clienteId: number): Promise<number | null> {
  if (!ramosPorMarca.has(clienteId)) {
    const [marca] = await db().select({ nichoId: clientes.nichoId }).from(clientes).where(eq(clientes.id, clienteId));
    ramosPorMarca.set(clienteId, marca?.nichoId ?? null);
  }
  return ramosPorMarca.get(clienteId) ?? null;
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
      definirRamoDoContexto(await ramoDaMarca(video.clienteId));
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
  restaurarRamoDoContexto();
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
      definirRamoDoContexto(await ramoDaMarca(video.clienteId));
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
  restaurarRamoDoContexto();
  return medidos;
}

type ResultadoInstagramMeta = {
  medidos: number;
  restantes: VideoParaMedir[];
  /** Token do SISTEMA vencido ou limite do aplicativo: quem chama para de tentar a Meta pelo resto da rodada. */
  indisponivel: boolean;
  /** Acesso da CONTA LIGADA que a Meta recusou ou sem permissao: a frase a guardar na conta; so vale para essa marca. */
  erroDaConta?: string;
};

/**
 * Como tratar um erro da Meta. Com o acesso de uma conta ligada (`comAcessoDaConta`), 190 e 102 (acesso recusado) e a falta de permissao sao problema DAQUELA conta: viram frase
 * para ela e param so a leitura dela. Sem ele (token do sistema, V8), qualquer 190 ou limite afeta todas as contas. Limite do aplicativo (4, 17, 32, 613) e a pausa da Meta
 * valem para as duas vias.
 */
function classificarErroDaMeta(erro: unknown, comAcessoDaConta: boolean): { tipo: "conta"; frase: string } | { tipo: "global" } | { tipo: "outro" } {
  if (!(erro instanceof ErroMetaApi)) return { tipo: "outro" };
  if (comAcessoDaConta) {
    const frase = erroDaContaPara(erro.codigo);
    if (frase) return { tipo: "conta", frase };
  }
  return erroMetaEhTokenOuLimite(erro) ? { tipo: "global" } : { tipo: "outro" };
}

/** E19b: a via do Instagram não devolve `total_views_count` na mídia; as visualizações vêm do `insights` (`meta-api.ts`, `buscarViewsDaMidia`), só para vídeo. */
function precisaDeViewsPeloInsights(acesso: TokenOuAcesso | undefined, item: MetaMediaItem): boolean {
  if (acesso === undefined || typeof acesso === "string" || acesso.via !== "instagram") return false;
  return item.media_type === "VIDEO" || item.media_product_type === "REELS";
}

async function viewsDaMidia(item: MetaMediaItem, acesso: TokenOuAcesso | undefined): Promise<number> {
  if (acesso !== undefined && precisaDeViewsPeloInsights(acesso, item)) return buscarViewsDaMidia(item.id, acesso);
  return item.total_views_count ?? 0;
}

/**
 * Mede a Instagram de UM cliente pela Graph API da Meta (V8, item 2). Devolve
 * os que nao deu para medir por essa via (`restantes`, seguem para o
 * Apify) e `indisponivel` quando o motivo foi token vencido ou limite de
 * taxa: quem chama para de tentar a Meta pelo resto da rodada (o erro afeta
 * todas as contas, nao so esta). `tokenDaConta` (E19 PR 1): le pelo acesso da conta ligada
 * da propria marca em vez do usuario do sistema.
 */
async function medirInstagramMeta(
  videos: VideoParaMedir[],
  igId: string,
  agora: Date,
  erros: string[],
  tokenDaConta?: TokenOuAcesso,
): Promise<ResultadoInstagramMeta> {
  const semMediaId = videos.filter((v) => !v.metaMediaId);
  const comMediaId = videos.filter((v) => v.metaMediaId);
  const restantes: VideoParaMedir[] = [];
  const origem = tokenDaConta === undefined ? "meta" : "meta, conta ligada";
  let medidos = 0;

  if (semMediaId.length > 0) {
    let midiaPorCodigo: Map<string, MetaMediaItem> | null = null;
    try {
      const midias = await buscarMediaDaConta(igId, 10, tokenDaConta);
      midiaPorCodigo = new Map();
      for (const item of midias) {
        const codigo = item.permalink ? shortcodeDoPermalink(item.permalink) : null;
        if (codigo) midiaPorCodigo.set(codigo, item);
      }
    } catch (erro) {
      const tipo = classificarErroDaMeta(erro, tokenDaConta !== undefined);
      if (tipo.tipo === "conta") {
        erros.push(`instagram (${origem}) listar midia da conta ${igId}: acesso recusado ou sem permissao`);
        return { medidos: 0, restantes: videos, indisponivel: false, erroDaConta: tipo.frase };
      }
      if (tipo.tipo === "global") {
        erros.push(`instagram (${origem}) listar midia da conta ${igId}: token ou limite atingido: ${(erro as Error).message}`);
        return { medidos: 0, restantes: videos, indisponivel: true };
      }
      erros.push(`instagram (${origem}) listar midia da conta ${igId}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }

    for (const video of semMediaId) {
      const item = midiaPorCodigo?.get(video.idExterno);
      if (!item) {
        restantes.push(video);
        continue;
      }
      let views: number;
      try {
        views = await viewsDaMidia(item, tokenDaConta);
      } catch (erro) {
        const tipo = classificarErroDaMeta(erro, tokenDaConta !== undefined);
        if (tipo.tipo === "conta") {
          erros.push(`instagram (${origem}) ${video.idExterno}: acesso recusado ou sem permissao`);
          restantes.push(...semMediaId.slice(semMediaId.indexOf(video)));
          return { medidos, restantes: [...restantes, ...comMediaId], indisponivel: false, erroDaConta: tipo.frase };
        }
        if (tipo.tipo === "global") {
          erros.push(`instagram (${origem}) ${video.idExterno}: token ou limite atingido: ${(erro as Error).message}`);
          restantes.push(...semMediaId.slice(semMediaId.indexOf(video)));
          return { medidos, restantes: [...restantes, ...comMediaId], indisponivel: true };
        }
        // Erro passageiro nas visualizações (a Meta ainda não tem o número): este vídeo segue para o caminho de sempre.
        erros.push(`instagram (${origem}) ${video.idExterno}: ${erro instanceof Error ? erro.message : String(erro)}`);
        restantes.push(video);
        continue;
      }
      await gravarMetrica(video, { views, likes: item.like_count ?? 0, comentarios: item.comments_count ?? 0 }, agora, FONTE_META, item.id);
      medidos += 1;
    }
  }

  for (let i = 0; i < comMediaId.length; i += 1) {
    const video = comMediaId[i];
    try {
      const item = await buscarMediaPorId(video.metaMediaId!, tokenDaConta);
      const views = await viewsDaMidia(item, tokenDaConta);
      await gravarMetrica(video, { views, likes: item.like_count ?? 0, comentarios: item.comments_count ?? 0 }, agora, FONTE_META);
      medidos += 1;
    } catch (erro) {
      const tipo = classificarErroDaMeta(erro, tokenDaConta !== undefined);
      if (tipo.tipo === "conta") {
        erros.push(`instagram (${origem}) ${video.idExterno}: acesso recusado ou sem permissao`);
        restantes.push(...comMediaId.slice(i));
        return { medidos, restantes, indisponivel: false, erroDaConta: tipo.frase };
      }
      if (tipo.tipo === "global") {
        erros.push(`instagram (${origem}) ${video.idExterno}: token ou limite atingido: ${(erro as Error).message}`);
        restantes.push(...comMediaId.slice(i));
        return { medidos, restantes, indisponivel: true };
      }
      erros.push(`instagram (${origem}) ${video.idExterno}: ${erro instanceof Error ? erro.message : String(erro)}`);
      restantes.push(video);
    }
  }

  return { medidos, restantes, indisponivel: false };
}

/**
 * Orquestra o Instagram de todos os clientes devidos (V8, itens 1 e 2; E19 PR 1): um
 * cliente por vez, primeiro pela conta que a PROPRIA marca ligou (se ligou), depois pela Meta
 * com o usuario do sistema quando tem (ou consegue) `meta_ig_id`, e o Apify no que sobrar.
 * `metaIndisponivel` para de tentar a Meta pelo token do sistema assim que um erro de token ou de
 * limite acontecer, pelo resto desta chamada; `limiteDaMeta` (limite do aplicativo) para as duas vias.
 */
async function medirInstagram(
  videos: VideoParaMedir[],
  agora: Date,
  erros: string[],
): Promise<{ medidosMeta: number; medidosContaLigada: number; medidosApify: number }> {
  if (videos.length === 0) return { medidosMeta: 0, medidosContaLigada: 0, medidosApify: 0 };

  let metaIndisponivel = !config.coleta.metaAtivo;
  let limiteDaMeta = false;
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
  let medidosContaLigada = 0;
  const restantesParaApify: VideoParaMedir[] = [];

  for (const [clienteId, videosDoCliente] of porCliente) {
    let pendentes = videosDoCliente;

    // 1) A conta que a propria marca ligou: o acesso dela, so para os videos dela (`clienteId` e o da marca de cada video).
    if (!limiteDaMeta) {
      const conta = await contaParaLeitura(clienteId, agora);
      if (conta) {
        const resultado = await medirInstagramMeta(pendentes, conta.igId, agora, erros, conta.via === "instagram" ? { token: conta.token, via: conta.via } : conta.token);
        medidosMeta += resultado.medidos;
        medidosContaLigada += resultado.medidos;
        pendentes = resultado.restantes;
        if (resultado.erroDaConta) await registrarErroDaConta(conta.id, resultado.erroDaConta, agora);
        else if (resultado.medidos > 0) await registrarLeituraDaConta(conta.id, agora);
        if (resultado.indisponivel) limiteDaMeta = true;
      }
    }
    if (pendentes.length === 0) continue;

    // 2) O usuario do sistema (V8), quando a Meta esta ativa e disponivel.
    if (metaIndisponivel || limiteDaMeta) {
      restantesParaApify.push(...pendentes);
      continue;
    }

    let igId: string | null;
    try {
      igId = idsJaResolvidos.get(clienteId) ?? (await resolverMetaIgId(clienteId));
    } catch (erro) {
      // `resolverMetaIgId` so relanca erro de token ou de limite (afeta todos os clientes, nao so este).
      erros.push(`instagram (meta) resolver a conta do cliente ${clienteId}: token ou limite atingido: ${erro instanceof Error ? erro.message : String(erro)}`);
      metaIndisponivel = true;
      restantesParaApify.push(...pendentes);
      continue;
    }
    if (!igId) {
      restantesParaApify.push(...pendentes);
      continue;
    }

    const resultado = await medirInstagramMeta(pendentes, igId, agora, erros);
    medidosMeta += resultado.medidos;
    restantesParaApify.push(...resultado.restantes);
    if (resultado.indisponivel) metaIndisponivel = true;
  }

  const medidosApify = await medirInstagramApify(restantesParaApify, agora, erros);
  return { medidosMeta, medidosContaLigada, medidosApify };
}

export async function rodarCurvaCliente(agora = new Date()): Promise<Record<string, unknown>> {
  const candidatos = await videosParaMedir(agora);
  // E22 PR 3: marca sem assinatura (cobrança ligada) não é medida (Meta, Apify e YouTube são chamadas por ela). O que já foi medido fica guardado; se ela assinar de novo, volta a ser medida.
  // Só conta como pulada a marca que teria vídeo para medir nesta hora.
  const naHora = candidatos.filter((v) => estaNaHoraDeMedir(v.postadoEm, v.ultimaColeta, agora));
  const { liberadas, puladas } = await separarMarcasPorAssinatura(naHora.map((v) => v.clienteId), { agora });
  registrarMarcasPuladas("curva-cliente", puladas.length);
  const devidos = naHora.filter((v) => liberadas.has(v.clienteId));

  const porPlataforma = {
    youtube: devidos.filter((v) => v.plataforma === "youtube"),
    tiktok: devidos.filter((v) => v.plataforma === "tiktok"),
    instagram: devidos.filter((v) => v.plataforma === "instagram"),
  };

  const erros: string[] = [];
  const medidosYoutube = await medirYoutube(porPlataforma.youtube, agora, erros);
  const medidosTiktok = await medirTiktok(porPlataforma.tiktok, agora, erros);
  const {
    medidosMeta: medidosInstagramMeta,
    medidosContaLigada: medidosInstagramContaLigada,
    medidosApify: medidosInstagramApify,
  } = await medirInstagram(
    porPlataforma.instagram,
    agora,
    erros,
  );

  return {
    candidatos: candidatos.length,
    devidos: devidos.length,
    ...resumoDasMarcasPuladas(puladas.length),
    medidosYoutube,
    medidosTiktok,
    medidosInstagramMeta,
    medidosInstagramContaLigada,
    medidosInstagramApify,
    erros: erros.length > 0 ? erros : undefined,
  };
}
