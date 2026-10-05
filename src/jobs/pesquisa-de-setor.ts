/**
 * Job `pesquisa-de-setor` (M2, decisão do Gustavo em 30/09/2026: "a gente tem que adicionar uma
 * pesquisa dos maiores do mercado, sempre. Mesmo que o Bruno não tenha colocado lá no setor, a
 * gente tem que pesquisar e a gente mesmo colocar."). Roda quando o setor é criado, quando o
 * admin pede "Pesquisar o mercado de novo", e uma vez por mês para os setores ativos.
 *
 * A regra que não muda: nada entra por memória do modelo. `sugerirContasDoSetor` propõe perfis,
 * mas cada um só vira conta semente depois de existir de verdade na API da rede (item a seguir) e
 * passar pelo filtro de código e pelo filtro de IA (`classificarContaDoSetor`). Handle sugerido
 * que a API não acha é descartado e contado no resumo como "sugerido e nao existe".
 *
 * As três fontes (item 1): (a) YouTube pela Data API, busca por termo com `type=channel` mais os
 * canais donos dos vídeos mais vistos por termo nos últimos 90 dias; (b) Instagram pela Meta, só
 * leitura informativa do `recent_media` das hashtags do setor (a API nunca devolve o dono de um
 * post de hashtag, então nenhum candidato de Instagram vem daqui, só o resumo "quantos Reels
 * fortes existem no assunto"); (c) sugestão do modelo forte, sempre conferida na API da rede
 * antes de entrar, para as três redes. TikTok (d) é só conferência dos handles sugeridos, pelo
 * Apify, dentro do teto diário (sem busca de descoberta própria: o Apify não tem um endpoint de
 * busca por assunto para TikTok neste ator).
 *
 * Vale o teto de duração do hotfix #72 nas contagens de "posta vídeo curto"; Instagram nunca tem
 * duração pela Business Discovery, então o critério conta como satisfeito por definição (um Reels
 * já é limitado a 90s pela própria plataforma).
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { consumoApi, contas, nichos, pesquisasSetor, type Plataforma, type ResumoPesquisaSetor } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as classificarContaDoSetor from "@/ia/prompts/classificarContaDoSetor";
import * as sugerirContasDoSetor from "@/ia/prompts/sugerirContasDoSetor";
import { calcularCustoUsd, registrarGeracao } from "@/ia/registro";
import { buscarBusinessDiscovery, buscarIdDaHashtag, buscarRecentMediaDaHashtag, chamadasDesde, ErroMetaApi, erroMetaEhDaConta } from "@/jobs/meta-api";
import { config, hojeISO } from "@/lib/config";
import { logger } from "@/lib/log";
import { normalizarBusinessDiscovery } from "@/servicos/normalizadores/meta";
import { normalizarVideoTiktok } from "@/servicos/normalizadores/tiktok";
import { normalizarVideoYoutube } from "@/servicos/normalizadores/youtube";
import { contaEhBrasileira } from "@/servicos/proporcao-brasil";

import { buscarTiktokVigilancia } from "./apify-api";
import { upsertConta, upsertVideo, type VideoParaGravar } from "./coleta-comum";
import { definirRamoDoContexto, restaurarRamoDoContexto } from "./contexto-execucao";
import { rodarExtrairAgora } from "./extrair-agora";
import { rodarPontuar } from "./pontuar";
import { rodarTemasDoDia } from "./temas-do-dia";
import { rodarTranscrever } from "./transcrever";
import {
  buscarCanaisPorTermo,
  buscarCanal,
  buscarPorTermo,
  buscarUploadsDoCanal,
  buscarVideosPorId,
  CUSTO_LISTA,
  CUSTO_SEARCH,
  ErroYoutubeApi,
} from "./youtube-api";

/** Até 30 por rede (item 3), nunca mais. */
const TOP_POR_REDE = 30;
/** Últimos 90 dias (item 1a), não os 7 da coleta diária: pesquisa de mercado, não "o que subiu hoje". */
const JANELA_DIAS_BUSCA_YOUTUBE = 90;
const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;
const FONTE_YOUTUBE = "youtube";
const FONTE_APIFY = "apify";
/** Vídeos por candidato conferido: o bastante para os últimos 20 da regra, com folga para o filtro de duração. */
const VIDEOS_POR_CANDIDATO = 20;

type Rede = "youtube" | "tiktok" | "instagram";

export type VideoConfirmacao = { views: number; duracaoS: number | null; publicadoEm: Date | null; idioma: string | null; titulo: string | null };

export type ContaConfirmada = {
  plataforma: Rede;
  /** Para YouTube, o id do canal (a chave real em `contas.handle`), não o @handle que a sugestão deu. */
  handle: string;
  nome: string | null;
  url: string | null;
  seguidores: number | null;
  pais: string | null;
  videos: VideoConfirmacao[];
  videosParaGravar: VideoParaGravar[];
};

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

function mediana(numeros: number[]): number {
  if (numeros.length === 0) return 0;
  const ordenados = [...numeros].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0 ? (ordenados[meio - 1] + ordenados[meio]) / 2 : ordenados[meio];
}

function modaIdioma(idiomas: (string | null)[]): string | null {
  const contagem = new Map<string, number>();
  for (const idioma of idiomas) {
    if (!idioma) continue;
    contagem.set(idioma, (contagem.get(idioma) ?? 0) + 1);
  }
  let melhor: string | null = null;
  let maiorContagem = 0;
  for (const [idioma, quantidade] of contagem) {
    if (quantidade > maiorContagem) {
      melhor = idioma;
      maiorContagem = quantidade;
    }
  }
  return melhor;
}

/**
 * Já tem conta com este handle marcada como "tirada" pelo admin (item 3: "conta tirada não volta
 * na pesquisa seguinte")? Confere antes de gastar qualquer chamada de API com o candidato.
 */
async function candidatoFoiTirado(plataforma: Rede, handle: string): Promise<boolean> {
  const [linha] = await db()
    .select({ removidaEm: contas.removidaEm })
    .from(contas)
    .where(and(eq(contas.plataforma, plataforma as Plataforma), eq(contas.handle, handle)));
  return linha?.removidaEm != null;
}

/**
 * `ignorarTirada`: quem confere o @ da PRÓPRIA marca de um cliente (`entender-marca`, `analisar-perfil` da própria marca) não pode
 * ser barrado porque o admin tirou essa conta da vigilância do setor; a lista de "tiradas" é da pesquisa do setor, não da pessoa.
 */
export type OpcoesConfirmar = { ignorarTirada?: boolean };

/** YouTube: resolve @handle ou nome para o canal de verdade, pega até `VIDEOS_POR_CANDIDATO` vídeos recentes. */
export async function confirmarYoutube(handleOuNome: string, opcoes: OpcoesConfirmar = {}): Promise<ContaConfirmada | null> {
  const canalResp = await buscarCanal(handleOuNome);
  await registrarConsumo(FONTE_YOUTUBE, CUSTO_LISTA);
  const canal = canalResp.items?.[0];
  if (!canal) return null;

  if (!opcoes.ignorarTirada && (await candidatoFoiTirado("youtube", canal.id))) return null;

  const uploadsResp = await buscarUploadsDoCanal(canal.contentDetails.relatedPlaylists.uploads);
  await registrarConsumo(FONTE_YOUTUBE, CUSTO_LISTA);
  const ids = (uploadsResp.items ?? []).slice(0, VIDEOS_POR_CANDIDATO).map((item) => item.snippet.resourceId.videoId);
  if (ids.length === 0) return null;

  const videosResp = await buscarVideosPorId(ids);
  await registrarConsumo(FONTE_YOUTUBE, CUSTO_LISTA);
  const normalizados = (videosResp.items ?? []).map(normalizarVideoYoutube);

  return {
    plataforma: "youtube",
    handle: canal.id,
    nome: canal.snippet.title || null,
    url: `https://www.youtube.com/channel/${canal.id}`,
    seguidores: null,
    pais: canal.snippet.country ?? null,
    videos: normalizados.map((n) => ({
      views: n.video.views,
      duracaoS: n.video.duracaoS,
      publicadoEm: n.video.publicadoEm,
      idioma: n.video.idioma,
      titulo: n.video.titulo,
    })),
    videosParaGravar: normalizados.map((n) => n.video),
  };
}

/** Instagram: Business Discovery (grátis), o mesmo caminho que `contas-base.ts` usa no catch-up diário. */
export async function confirmarInstagram(handle: string, opcoes: OpcoesConfirmar = {}): Promise<ContaConfirmada | null> {
  // O @ entra cru na expressão de campos da Graph API (`business_discovery.username(...)`): quem chega aqui por um campo
  // que a pessoa escreve (a Conta, o briefing) nunca pode trazer parênteses, chaves ou vírgula. Só o que o Instagram permite.
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return null;
  if (!config.coleta.metaAtivo) return null;
  if (!opcoes.ignorarTirada && (await candidatoFoiTirado("instagram", handle))) return null;

  const discovery = await buscarBusinessDiscovery(handle, VIDEOS_POR_CANDIDATO);
  if (!discovery) return null;

  const { conta, videos: videosNormalizados } = normalizarBusinessDiscovery(handle, discovery);
  return {
    plataforma: "instagram",
    handle,
    nome: conta.nome,
    url: conta.url,
    seguidores: conta.seguidores,
    pais: null,
    videos: videosNormalizados.map((v) => ({
      views: v.views,
      // A Business Discovery nunca devolve duração; ver comentário no topo do arquivo.
      duracaoS: null,
      publicadoEm: v.publicadoEm,
      idioma: v.idioma,
      titulo: v.titulo,
    })),
    videosParaGravar: videosNormalizados,
  };
}

/** TikTok: só conferência pelo Apify, dentro do teto diário (item 1d: sem busca de descoberta própria). */
async function confirmarTiktok(handle: string, apifyCabe: () => boolean): Promise<ContaConfirmada | null> {
  if (await candidatoFoiTirado("tiktok", handle)) return null;
  if (!apifyCabe()) return null;

  const { itens } = await buscarTiktokVigilancia([handle], VIDEOS_POR_CANDIDATO, VIDEOS_POR_CANDIDATO);
  await registrarConsumo(FONTE_APIFY, itens.length);
  if (itens.length === 0) return null;

  const normalizados = itens.map(normalizarVideoTiktok).filter((n): n is NonNullable<typeof n> => n !== null);
  if (normalizados.length === 0) return null;
  const conta = normalizados[0].conta;

  return {
    plataforma: "tiktok",
    handle: conta.handle,
    nome: conta.nome,
    url: conta.url,
    seguidores: conta.seguidores,
    pais: null,
    videos: normalizados.map((n) => ({
      views: n.video.views,
      duracaoS: n.video.duracaoS,
      publicadoEm: n.video.publicadoEm,
      idioma: n.video.idioma,
      titulo: n.video.titulo,
    })),
    videosParaGravar: normalizados.map((n) => n.video),
  };
}

export type MotivoDescarte =
  | "sugerido_e_nao_existe"
  /** Item 0c da revisão dos PRs #74/#76: canal do YouTube existe mas não tem playlist de uploads. */
  | "sem_videos"
  | "video_longo_demais"
  | "nao_brasileiro"
  | "inativo"
  | "sem_alcance"
  | "fora_do_setor"
  | "erro_na_classificacao";

/** Item 2, o filtro por código (tudo antes da IA, que é mais cara). */
export function passaNoFiltroDeCodigo(candidato: ContaConfirmada): MotivoDescarte | null {
  if (candidato.plataforma !== "instagram") {
    const curtos = candidato.videos.filter((v) => v.duracaoS !== null && v.duracaoS <= config.regras.tetoDuracaoReferenciaS);
    if (curtos.length < 5) return "video_longo_demais";
  }
  // Instagram: Reels já são curtos por definição da plataforma (a Business Discovery nunca devolve duração).

  const idiomaPrincipal = modaIdioma(candidato.videos.map((v) => v.idioma));
  if (!contaEhBrasileira(candidato.pais, idiomaPrincipal)) return "nao_brasileiro";

  const agora = Date.now();
  const postouRecente = candidato.videos.some((v) => v.publicadoEm && agora - v.publicadoEm.getTime() <= TRINTA_DIAS_MS);
  if (!postouRecente) return "inativo";

  const medianaViews = mediana(candidato.videos.map((v) => v.views));
  if (medianaViews < config.regras.alcanceMinimoContaSetor) return "sem_alcance";

  return null;
}

export async function passaNoFiltroDeSetor(
  candidato: ContaConfirmada,
  nomeSetor: string,
  termosSetor: string[],
): Promise<{ pertence: boolean; custoUsd: number }> {
  const titulos = candidato.videos.map((v) => v.titulo).filter((t): t is string => Boolean(t));
  if (titulos.length === 0) return { pertence: false, custoUsd: 0 };

  const resultado = await gerarEstruturado({
    tarefa: "classificarContaDoSetor",
    nivel: classificarContaDoSetor.nivel,
    effort: classificarContaDoSetor.esforco,
    schema: classificarContaDoSetor.schema,
    sistemaEstavel: classificarContaDoSetor.montarSistemaEstavel(),
    entrada: classificarContaDoSetor.montarEntrada({ nomeSetor, termosSetor, titulos }),
  });
  await registrarGeracao({
    tarefa: "classificarContaDoSetor",
    versaoPrompt: classificarContaDoSetor.versao,
    modelo: resultado.modelo,
    nivel: classificarContaDoSetor.nivel,
    entradas: { plataforma: candidato.plataforma, handle: candidato.handle },
    saida: resultado.dados,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
  });
  const custoUsd = calcularCustoUsd(classificarContaDoSetor.nivel, {
    tokensEntrada: resultado.tokensEntrada,
    tokensSaida: resultado.tokensSaida,
    tokensCacheLeitura: resultado.tokensCacheLeitura,
    tokensCacheEscrita: resultado.tokensCacheEscrita,
  });
  return { pertence: resultado.dados.pertenceAoSetor, custoUsd };
}

type CandidatoAprovado = { candidato: ContaConfirmada; taxaAcimaDoPiso: number; medianaViews: number };

function rankearEcortar(aprovados: CandidatoAprovado[]): CandidatoAprovado[] {
  return [...aprovados]
    .sort((a, b) => b.taxaAcimaDoPiso - a.taxaAcimaDoPiso || b.medianaViews - a.medianaViews)
    .slice(0, TOP_POR_REDE);
}

/**
 * P2, item 0b da revisão do PR #74: cada termo custa 200 unidades do YouTube (duas buscas), então
 * só `config.coleta.termosPesquisaSetor` entram por rodada; os mais curtos primeiro, porque são
 * os mais genéricos (acham mais candidato). Função pura, para testar sem rede nem banco.
 */
export function escolherTermosParaPesquisa(termos: string[], limite: number): string[] {
  return [...termos].sort((a, b) => a.length - b.length).slice(0, limite);
}

/** YouTube, item 1a: canais que mais aparecem na busca por termo (`type=channel`) e donos dos vídeos mais vistos por termo. */
async function candidatosYoutubePorTermo(termos: string[]): Promise<string[]> {
  const candidatos = new Set<string>();
  for (const termo of escolherTermosParaPesquisa(termos, config.coleta.termosPesquisaSetor)) {
    const canaisResp = await buscarCanaisPorTermo(termo);
    await registrarConsumo(FONTE_YOUTUBE, CUSTO_SEARCH);
    for (const item of canaisResp.items ?? []) {
      if (item.id.channelId) candidatos.add(item.id.channelId);
    }

    const videosResp = await buscarPorTermo(termo, new Date(Date.now() - JANELA_DIAS_BUSCA_YOUTUBE * 24 * 60 * 60 * 1000));
    await registrarConsumo(FONTE_YOUTUBE, CUSTO_SEARCH);
    for (const item of videosResp.items ?? []) {
      candidatos.add(item.snippet.channelId);
    }
  }
  return [...candidatos];
}

/** Instagram, item 1b: só o resumo informativo (a API nunca devolve o dono do post da hashtag). */
async function resumoHashtagsDoSetor(termos: string[]): Promise<number> {
  if (!config.coleta.metaAtivo) return 0;
  let reelsFortes = 0;
  for (const termo of escolherTermosParaPesquisa(termos, config.coleta.termosPesquisaSetor)) {
    try {
      const hashtagId = await buscarIdDaHashtag(termo);
      if (!hashtagId) continue;
      const midias = await buscarRecentMediaDaHashtag(hashtagId);
      reelsFortes += midias.filter((m) => m.media_type === "VIDEO" || m.media_product_type === "REELS").length;
    } catch (erro) {
      logger.error({ err: erro, termo }, "pesquisa-de-setor: falha lendo hashtag do Instagram (so informativo)");
    }
  }
  return reelsFortes;
}

async function pesquisarUmSetor(nichoId: number): Promise<Record<string, unknown>> {
  const inicioDoJob = new Date();
  const [nicho] = await db().select().from(nichos).where(eq(nichos.id, nichoId));
  if (!nicho) throw new Error(`nicho ${nichoId} nao encontrado`);

  let custoIaUsd = 0;

  const sugestao = await gerarEstruturado({
    tarefa: "sugerirContasDoSetor",
    nivel: sugerirContasDoSetor.nivel,
    effort: sugerirContasDoSetor.esforco,
    schema: sugerirContasDoSetor.schema,
    sistemaEstavel: sugerirContasDoSetor.montarSistemaEstavel(),
    entrada: sugerirContasDoSetor.montarEntrada({ nomeSetor: nicho.nome, descricaoSetor: nicho.descricao, termosSetor: nicho.termos }),
  });
  await registrarGeracao({
    tarefa: "sugerirContasDoSetor",
    versaoPrompt: sugerirContasDoSetor.versao,
    modelo: sugestao.modelo,
    nivel: sugerirContasDoSetor.nivel,
    entradas: { nichoId },
    saida: sugestao.dados,
    uso: {
      tokensEntrada: sugestao.tokensEntrada,
      tokensSaida: sugestao.tokensSaida,
      tokensCacheLeitura: sugestao.tokensCacheLeitura,
      tokensCacheEscrita: sugestao.tokensCacheEscrita,
    },
  });
  custoIaUsd += calcularCustoUsd(sugerirContasDoSetor.nivel, {
    tokensEntrada: sugestao.tokensEntrada,
    tokensSaida: sugestao.tokensSaida,
    tokensCacheLeitura: sugestao.tokensCacheLeitura,
    tokensCacheEscrita: sugestao.tokensCacheEscrita,
  });

  const unidadesYoutubeAntes = await consumoDeHoje(FONTE_YOUTUBE);
  const apifyUsadoAntes = await consumoDeHoje(FONTE_APIFY);
  let apifyGastoNestaRodada = 0;
  const apifyCabe = () => apifyUsadoAntes + apifyGastoNestaRodada < config.coleta.apifyMaxResultadosDia;

  const candidatosPorRede: Record<Rede, string[]> = {
    youtube: sugestao.dados.contas.filter((c) => c.rede === "youtube").map((c) => c.handle),
    tiktok: sugestao.dados.contas.filter((c) => c.rede === "tiktok").map((c) => c.handle),
    instagram: sugestao.dados.contas.filter((c) => c.rede === "instagram").map((c) => c.handle),
  };
  const candidatosYoutubeDaBusca = await candidatosYoutubePorTermo(nicho.termos);
  candidatosPorRede.youtube.push(...candidatosYoutubeDaBusca);
  await resumoHashtagsDoSetor(nicho.termos);

  const sugeridas = {
    youtube: new Set(candidatosPorRede.youtube.map((h) => h.toLowerCase())).size,
    tiktok: candidatosPorRede.tiktok.length,
    instagram: candidatosPorRede.instagram.length,
  };
  const descartadas: Record<string, number> = {};
  const registrarDescarte = (motivo: string) => {
    descartadas[motivo] = (descartadas[motivo] ?? 0) + 1;
  };

  const aprovadosPorRede: Record<Rede, CandidatoAprovado[]> = { youtube: [], tiktok: [], instagram: [] };
  const jaProcessados = new Set<string>();

  for (const rede of ["youtube", "tiktok", "instagram"] as const) {
    const vistos = new Set<string>();
    for (const handleOuId of candidatosPorRede[rede]) {
      const chaveDeduplicacao = `${rede}:${handleOuId.toLowerCase()}`;
      if (vistos.has(chaveDeduplicacao)) continue;
      vistos.add(chaveDeduplicacao);

      let confirmado: ContaConfirmada | null;
      /**
       * Item 0c da revisão dos PRs #74/#76 (achado na primeira rodada em produção, 30/09): handle
       * inexistente (`ErroMetaApi` de código 100/110, "Invalid user id") e canal do YouTube sem
       * playlist de uploads (`ErroYoutubeApi` com "playlistNotFound" no corpo) são casos esperados
       * da conferência, não falha de verdade; viravam erro (nível 50) e o segundo entrava junto de
       * "sugerido e não existe", quando na verdade o canal existe, só não tem vídeo.
       */
      let motivoDoErro: "sem_videos" | null = null;
      try {
        if (rede === "youtube") confirmado = await confirmarYoutube(handleOuId);
        else if (rede === "instagram") confirmado = await confirmarInstagram(handleOuId);
        else {
          confirmado = await confirmarTiktok(handleOuId, apifyCabe);
          if (confirmado) apifyGastoNestaRodada += confirmado.videos.length;
        }
      } catch (erro) {
        if (erro instanceof ErroYoutubeApi && erro.message.includes("playlistNotFound")) {
          logger.warn({ rede, handle: handleOuId }, "pesquisa-de-setor: canal sem playlist de uploads (sem_videos)");
          motivoDoErro = "sem_videos";
        } else if (erro instanceof ErroMetaApi && erroMetaEhDaConta(erro)) {
          logger.warn({ rede, handle: handleOuId, motivo: erro.message }, "pesquisa-de-setor: handle sugerido nao existe");
        } else {
          logger.error({ err: erro, rede, handle: handleOuId }, "pesquisa-de-setor: falha conferindo candidato");
        }
        confirmado = null;
      }

      if (!confirmado) {
        registrarDescarte(motivoDoErro ?? "sugerido_e_nao_existe");
        continue;
      }
      const chaveFinal = `${confirmado.plataforma}:${confirmado.handle.toLowerCase()}`;
      if (jaProcessados.has(chaveFinal)) continue;
      jaProcessados.add(chaveFinal);

      const motivoCodigo = passaNoFiltroDeCodigo(confirmado);
      if (motivoCodigo) {
        registrarDescarte(motivoCodigo);
        continue;
      }

      // Hotfix de 30/09/2026: a classificação de um candidato falhava (400 da API por um título com
      // metade de emoji) e derrubava a pesquisa do setor inteiro, sem gravar nada. O erro de um
      // candidato é descarte dele, contado no resumo, e a rodada segue.
      let pertence: boolean;
      try {
        const filtro = await passaNoFiltroDeSetor(confirmado, nicho.nome, nicho.termos);
        custoIaUsd += filtro.custoUsd;
        pertence = filtro.pertence;
      } catch (erro) {
        logger.error({ err: erro, rede, handle: confirmado.handle }, "pesquisa-de-setor: falha classificando candidato");
        registrarDescarte("erro_na_classificacao");
        continue;
      }
      if (!pertence) {
        registrarDescarte("fora_do_setor");
        continue;
      }

      const acimaDoPiso = confirmado.videos.filter((v) => v.views >= config.regras.pisoViewsReferencia).length;
      aprovadosPorRede[rede].push({
        candidato: confirmado,
        taxaAcimaDoPiso: acimaDoPiso / confirmado.videos.length,
        medianaViews: mediana(confirmado.videos.map((v) => v.views)),
      });
    }
  }

  let contasNovas = 0;
  let contasAtualizadas = 0;
  const contasParaPrimeiraCarga: number[] = [];

  for (const rede of ["youtube", "tiktok", "instagram"] as const) {
    const top = rankearEcortar(aprovadosPorRede[rede]);
    for (const { candidato } of top) {
      const [existiaAntes] = await db()
        .select({ id: contas.id })
        .from(contas)
        .where(and(eq(contas.plataforma, candidato.plataforma as Plataforma), eq(contas.handle, candidato.handle)));

      const contaId = await upsertConta(
        {
          plataforma: candidato.plataforma as Plataforma,
          handle: candidato.handle,
          nome: candidato.nome,
          url: candidato.url,
          seguidores: candidato.seguidores,
          pais: candidato.pais,
        },
        nichoId,
      );
      // Semente (item 3): "pesquisa" nunca rebaixa uma conta que já é "curadoria" (escolha de gente vence).
      await db().execute(
        sql`UPDATE contas SET origem = 'pesquisa', vigiada = true WHERE id = ${contaId} AND origem <> 'curadoria'`,
      );

      for (const video of candidato.videosParaGravar) {
        await upsertVideo(video, contaId, nichoId);
      }
      if (existiaAntes) contasAtualizadas += 1;
      else contasNovas += 1;
      contasParaPrimeiraCarga.push(contaId);
    }
  }

  const resumo: ResumoPesquisaSetor = {
    sugeridas,
    confirmadas: {
      youtube: aprovadosPorRede.youtube.length,
      tiktok: aprovadosPorRede.tiktok.length,
      instagram: aprovadosPorRede.instagram.length,
    },
    descartadas,
    contasNovas,
    contasAtualizadas,
    termosSugeridos: sugestao.dados.termos,
    hashtagsSugeridas: sugestao.dados.hashtags,
    custo: {
      unidadesYoutube: (await consumoDeHoje(FONTE_YOUTUBE)) - unidadesYoutubeAntes,
      chamadasMeta: config.coleta.metaAtivo ? await chamadasDesde(inicioDoJob) : 0,
      resultadosApify: apifyGastoNestaRodada,
      custoIaUsd: Number(custoIaUsd.toFixed(4)),
    },
  };
  await db().insert(pesquisasSetor).values({ nichoId, resumo });

  /**
   * Item 4, "a primeira carga": pontuação (segundos), transcrição só deste setor (não espera os
   * outros nichos ativos), a análise imediata da M1 e os temas do dia, em sequência, na mesma
   * execução deste job, para o setor criado às 10h ter Referências antes do almoço. Cadeia de
   * verdade: cada passo espera o anterior terminar, ao contrário de `coletarAgoraAction` (item 0b
   * da revisão do PR #73), que só enfileira e não espera nada.
   *
   * `contasIds: contasParaPrimeiraCarga` (P2, item 0a da revisão do PR #74): um setor já
   * estabelecido (20 ou mais vídeos analisados no total) não entra mais no caminho de setor novo
   * da M1, mas as contas que esta rodada acabou de cadastrar ainda merecem leitura imediata, sem
   * esperar o lote da madrugada.
   */
  let temasGerados: number | undefined;
  if (contasParaPrimeiraCarga.length > 0) {
    await rodarPontuar();
    await rodarTranscrever(nichoId);
    await rodarExtrairAgora(nichoId, { contasIds: contasParaPrimeiraCarga });
    const temas = await rodarTemasDoDia(nichoId);
    temasGerados = (temas as { gerados?: number }).gerados;
  }

  return { nichoId, ...resumo, temasGerados };
}

/**
 * `nichoId` presente: só aquele setor (ao criar o setor, ou "Pesquisar o mercado de novo" no
 * admin). Ausente: todos os setores ativos (o cron mensal, item 1: "uma vez por mês para os
 * setores ativos"), um de cada vez, sem misturar erro de um com o resultado dos outros.
 */
export async function rodarPesquisaDeSetor(nichoId?: number): Promise<Record<string, unknown>> {
  if (nichoId !== undefined) return pesquisarUmSetor(nichoId);

  const nichosAtivos = await db().select({ id: nichos.id }).from(nichos).where(eq(nichos.ativo, true));
  const porNicho: Record<string, unknown>[] = [];
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    // O gasto de cada setor (Apify, IA) é dele, não do último da rodada mensal.
    definirRamoDoContexto(nicho.id);
    try {
      porNicho.push(await pesquisarUmSetor(nicho.id));
    } catch (erro) {
      erros.push(`nicho ${nicho.id}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  restaurarRamoDoContexto();
  return { nichos: nichosAtivos.length, porNicho, erros: erros.length > 0 ? erros : undefined };
}
