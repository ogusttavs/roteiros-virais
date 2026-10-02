/**
 * Job `extrairAgora` (M1, item 1: o setor novo não pode esperar o lote). Achado em produção em
 * 30/09/2026: a Overtake Pro tinha 48 vídeos transcritos e zero analisados no primeiro dia,
 * porque a análise só existe em lote (`extrair.ts`), assíncrono, até 24h; o lote do dia ficou
 * mais de três horas parado no provedor e o painel ficou vazio até a manhã seguinte.
 *
 * Setor com menos de `LIMITE_ANALISADOS_SETOR_NOVO` vídeos analisados não entra no lote: os
 * transcritos desse setor (os de maior múltiplo primeiro, até `LIMITE_CANDIDATOS_IMEDIATO`) são
 * analisados na hora, um a um, com o mesmo prompt e o mesmo nível de `extrair.ts`, sem lote
 * (custa o dobro por vídeo; só acontece nos primeiros dias do setor). Chamado por `rodarExtrair`
 * antes de montar o lote do dia (um vídeo nunca vai pelos dois caminhos: os que ganham `analise`
 * aqui somem da consulta do lote, que já filtra `analise is null`), e também direto, por um
 * `nichoId`, pelo botão "rodar a primeira coleta agora" do admin (item 4) e pela fila
 * `FILAS.extrairAgora`.
 *
 * Vale o teto de duração do hotfix #72: só vídeo de até `config.regras.tetoDuracaoReferenciaS`
 * (ou sem duração guardada) é lido e analisado, para não gastar a análise imediata, mais cara,
 * num vídeo que a tela nunca mostraria de qualquer jeito.
 */
import { and, count, desc, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { nichos, videos } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as extrairVideo from "@/ia/prompts/extrairVideo";
import { registrarGeracao } from "@/ia/registro";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { logger } from "@/lib/log";
import { DENTRO_DO_TETO_DE_DURACAO } from "@/servicos/pesquisa";

import { aplicarResultadoExtracao, idsEmLotePendente, precisaAgendarNovaTentativa, resolverIdioma, TAMANHO_MINIMO_TRANSCRICAO } from "./extracao-comum";

/** Setor com menos que isto de vídeos analisados é "novo": não espera o lote. */
export const LIMITE_ANALISADOS_SETOR_NOVO = 20;
/** Nunca mais que isto por rodada, por setor: é caminho de emergência, não substitui o lote. */
export const LIMITE_CANDIDATOS_IMEDIATO = 40;
const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

async function nichosParaAnaliseImediata(nichoId?: number): Promise<{ id: number; slug: string }[]> {
  const condicoes = [eq(nichos.ativo, true)];
  if (nichoId !== undefined) condicoes.push(eq(nichos.id, nichoId));
  const candidatos = await db()
    .select({ id: nichos.id, slug: nichos.slug })
    .from(nichos)
    .where(and(...condicoes));
  if (candidatos.length === 0) return [];

  const analisados = await db()
    .select({ nichoId: videos.nichoId, quantidade: count() })
    .from(videos)
    .where(and(inArray(videos.nichoId, candidatos.map((n) => n.id)), isNotNull(videos.analise)))
    .groupBy(videos.nichoId);
  const analisadosPorNicho = new Map(analisados.map((a) => [a.nichoId, a.quantidade]));

  return candidatos.filter((n) => (analisadosPorNicho.get(n.id) ?? 0) < LIMITE_ANALISADOS_SETOR_NOVO);
}

type CandidatoImediato = { id: number; titulo: string | null; transcricao: string | null; proximaTentativaTranscricao: Date | null };

/**
 * `contasIds` (P2, item 0a): escopa aos vídeos dessas contas, em vez de todo o setor. Usado pela
 * primeira carga do `pesquisa-de-setor.ts`, que quer analisar só as contas que acabou de
 * cadastrar, mesmo num setor já estabelecido (com 20 ou mais vídeos analisados no total).
 *
 * Achado 13 da revisão do motor (01/10/2026): `idsPendentes` (vídeo já num lote de `extrairVideo`
 * ainda em andamento) nunca entra aqui também, mesmo caminho mais caro que o lote.
 */
async function candidatosDoSetor(nichoId: number, idsPendentes: Set<number>, contasIds?: number[]): Promise<CandidatoImediato[]> {
  const condicoes = [eq(videos.nichoId, nichoId), isNotNull(videos.transcricao), isNull(videos.analise), DENTRO_DO_TETO_DE_DURACAO];
  if (idsPendentes.size > 0) condicoes.push(notInArray(videos.id, [...idsPendentes]));
  if (contasIds && contasIds.length > 0) condicoes.push(inArray(videos.contaId, contasIds));

  return db()
    .select({ id: videos.id, titulo: videos.titulo, transcricao: videos.transcricao, proximaTentativaTranscricao: videos.proximaTentativaTranscricao })
    .from(videos)
    .where(and(...condicoes))
    .orderBy(sql`${videos.foraDaCurva} desc nulls last`, desc(videos.views))
    .limit(LIMITE_CANDIDATOS_IMEDIATO);
}

async function extrairUmVideo(
  video: CandidatoImediato,
  nomeNicho: string,
  termosNicho: string[],
): Promise<{ reprovadoPorIdioma: boolean }> {
  const resultado = await gerarEstruturado({
    tarefa: "extrairVideo",
    nivel: extrairVideo.nivel,
    effort: extrairVideo.esforco,
    schema: extrairVideo.schema,
    sistemaEstavel: extrairVideo.montarSistemaEstavel(),
    entrada: extrairVideo.montarEntrada({
      titulo: video.titulo ?? "",
      transcricao: video.transcricao ?? "",
      nomeNicho,
      termosNicho,
    }),
  });

  const { dados, reprovadoPorIdioma } = await resolverIdioma(video.id, resultado.dados);
  await aplicarResultadoExtracao(video.id, dados);

  await registrarGeracao({
    tarefa: "extrairVideo",
    versaoPrompt: extrairVideo.versao,
    modelo: resultado.modelo,
    nivel: extrairVideo.nivel,
    entradas: { videoId: video.id, imediato: true },
    saida: resultado.dados,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
    emLote: false,
  });

  return { reprovadoPorIdioma };
}

type ResultadoNicho = {
  videosAnalisados: number;
  transcricaoCurtaDemais: number;
  reprovadosPorIdioma: number;
  temaEnfileirado: boolean;
  erros: string[];
};

async function processarNicho(nicho: { id: number; slug: string }, candidatos: CandidatoImediato[]): Promise<ResultadoNicho> {
  const curtos = candidatos.filter((v) => (v.transcricao ?? "").trim().length < TAMANHO_MINIMO_TRANSCRICAO);
  const prontos = candidatos.filter((v) => (v.transcricao ?? "").trim().length >= TAMANHO_MINIMO_TRANSCRICAO);
  const resultado: ResultadoNicho = { videosAnalisados: 0, transcricaoCurtaDemais: 0, reprovadosPorIdioma: 0, temaEnfileirado: false, erros: [] };

  if (curtos.length > 0) {
    const agora = new Date();
    const curtosParaAgendar = curtos.filter((v) => precisaAgendarNovaTentativa(v.proximaTentativaTranscricao, agora));
    if (curtosParaAgendar.length > 0) {
      await db()
        .update(videos)
        .set({ proximaTentativaTranscricao: new Date(Date.now() + SETE_DIAS_MS) })
        .where(
          inArray(
            videos.id,
            curtosParaAgendar.map((v) => v.id),
          ),
        );
    }
    resultado.transcricaoCurtaDemais = curtos.length;
  }

  if (prontos.length === 0) return resultado;

  const [linhaNicho] = await db().select({ nome: nichos.nome, termos: nichos.termos }).from(nichos).where(eq(nichos.id, nicho.id));
  if (!linhaNicho) return resultado;

  let algumAnalisado = false;
  for (const video of prontos) {
    try {
      const { reprovadoPorIdioma } = await extrairUmVideo(video, linhaNicho.nome, linhaNicho.termos);
      resultado.videosAnalisados += 1;
      algumAnalisado = true;
      if (reprovadoPorIdioma) resultado.reprovadosPorIdioma += 1;
    } catch (erro) {
      resultado.erros.push(`setor "${nicho.slug}", video ${video.id}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  // M1, item 2: os temas nascem quando a análise chega, não só às 06:30; `temasDoDia` com
  // `nichoId` confere sozinho se o setor já tem tema hoje e pula se tiver. A fila nunca
  // derruba a análise (mesma regra de `reprovarERescrever`, E27 parte 2): se o pg-boss
  // estiver fora do ar, o erro fica só no log.
  if (algumAnalisado) {
    try {
      await garantirBossPronto();
      await boss().send(FILAS.temasDoDia, { nichoId: nicho.id });
      resultado.temaEnfileirado = true;
    } catch (erro) {
      logger.error({ err: erro, nichoId: nicho.id }, "nao foi possivel enfileirar temas-do-dia depois da analise imediata");
    }
  }

  return resultado;
}

/**
 * `nichoId` presente, sem `opts`: só aquele setor, com a regra de sempre (menos de
 * `LIMITE_ANALISADOS_SETOR_NOVO` no total, o "rodar agora" do admin, item 4). Ausente: todos os
 * setores ativos que se qualificam (chamado por `rodarExtrair`, antes de montar o lote do dia).
 *
 * `opts.contasIds` (P2, item 0a): ignora a regra de setor novo e analisa só os vídeos dessas
 * contas, até o mesmo teto de `LIMITE_CANDIDATOS_IMEDIATO`. Usado pela primeira carga do
 * `pesquisa-de-setor.ts`: um setor já estabelecido (52 vídeos analisados, por exemplo) não entra
 * mais no caminho de setor novo, mas as contas que a pesquisa acabou de cadastrar ainda merecem
 * leitura imediata, sem esperar o lote da madrugada. Exige `nichoId`.
 */
export async function rodarExtrairAgora(nichoId?: number, opts?: { contasIds?: number[] }): Promise<Record<string, unknown>> {
  const idsPendentes = await idsEmLotePendente("extrairVideo");

  if (opts?.contasIds && opts.contasIds.length > 0) {
    if (nichoId === undefined) throw new Error("rodarExtrairAgora: contasIds precisa de nichoId");
    const [nicho] = await db().select({ id: nichos.id, slug: nichos.slug }).from(nichos).where(eq(nichos.id, nichoId));
    if (!nicho) return { setoresNovos: 0, videosAnalisados: 0, transcricaoCurtaDemais: 0, reprovadosPorIdioma: 0, setoresComTemaEnfileirado: 0 };

    const candidatos = await candidatosDoSetor(nichoId, idsPendentes, opts.contasIds);
    const resultado = await processarNicho(nicho, candidatos);
    return {
      setoresNovos: 1,
      videosAnalisados: resultado.videosAnalisados,
      transcricaoCurtaDemais: resultado.transcricaoCurtaDemais,
      reprovadosPorIdioma: resultado.reprovadosPorIdioma,
      setoresComTemaEnfileirado: resultado.temaEnfileirado ? 1 : 0,
      erros: resultado.erros.length > 0 ? resultado.erros : undefined,
    };
  }

  const nichosNovos = await nichosParaAnaliseImediata(nichoId);

  let videosAnalisados = 0;
  let transcricaoCurtaDemais = 0;
  let reprovadosPorIdioma = 0;
  let setoresComTemaEnfileirado = 0;
  const erros: string[] = [];

  for (const nicho of nichosNovos) {
    const candidatos = await candidatosDoSetor(nicho.id, idsPendentes);
    const resultado = await processarNicho(nicho, candidatos);
    videosAnalisados += resultado.videosAnalisados;
    transcricaoCurtaDemais += resultado.transcricaoCurtaDemais;
    reprovadosPorIdioma += resultado.reprovadosPorIdioma;
    if (resultado.temaEnfileirado) setoresComTemaEnfileirado += 1;
    erros.push(...resultado.erros);
  }

  return {
    setoresNovos: nichosNovos.length,
    videosAnalisados,
    transcricaoCurtaDemais,
    reprovadosPorIdioma,
    setoresComTemaEnfileirado,
    erros: erros.length > 0 ? erros : undefined,
  };
}
