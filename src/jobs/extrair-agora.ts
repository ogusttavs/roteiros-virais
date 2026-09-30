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
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { nichos, videos } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as extrairVideo from "@/ia/prompts/extrairVideo";
import { registrarGeracao } from "@/ia/registro";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { logger } from "@/lib/log";
import { DENTRO_DO_TETO_DE_DURACAO } from "@/servicos/pesquisa";

import { aplicarResultadoExtracao, resolverIdioma, TAMANHO_MINIMO_TRANSCRICAO } from "./extracao-comum";

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

type CandidatoImediato = { id: number; titulo: string | null; transcricao: string | null };

async function candidatosDoSetor(nichoId: number): Promise<CandidatoImediato[]> {
  return db()
    .select({ id: videos.id, titulo: videos.titulo, transcricao: videos.transcricao })
    .from(videos)
    .where(
      and(
        eq(videos.nichoId, nichoId),
        isNotNull(videos.transcricao),
        isNull(videos.analise),
        DENTRO_DO_TETO_DE_DURACAO,
      ),
    )
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

/**
 * `nichoId` presente: só aquele setor (o "rodar agora" do admin, item 4). Ausente: todos os
 * setores ativos com menos de `LIMITE_ANALISADOS_SETOR_NOVO` analisados (chamado por
 * `rodarExtrair`, antes de montar o lote do dia).
 */
export async function rodarExtrairAgora(nichoId?: number): Promise<Record<string, unknown>> {
  const nichosNovos = await nichosParaAnaliseImediata(nichoId);

  let videosAnalisados = 0;
  let transcricaoCurtaDemais = 0;
  let reprovadosPorIdioma = 0;
  let setoresComTemaEnfileirado = 0;
  const erros: string[] = [];

  for (const nicho of nichosNovos) {
    const candidatos = await candidatosDoSetor(nicho.id);
    const curtos = candidatos.filter((v) => (v.transcricao ?? "").trim().length < TAMANHO_MINIMO_TRANSCRICAO);
    const prontos = candidatos.filter((v) => (v.transcricao ?? "").trim().length >= TAMANHO_MINIMO_TRANSCRICAO);

    if (curtos.length > 0) {
      await db()
        .update(videos)
        .set({ proximaTentativaTranscricao: new Date(Date.now() + SETE_DIAS_MS) })
        .where(
          inArray(
            videos.id,
            curtos.map((v) => v.id),
          ),
        );
      transcricaoCurtaDemais += curtos.length;
    }

    if (prontos.length === 0) continue;

    const [linhaNicho] = await db().select({ nome: nichos.nome, termos: nichos.termos }).from(nichos).where(eq(nichos.id, nicho.id));
    if (!linhaNicho) continue;

    let algumAnalisado = false;
    for (const video of prontos) {
      try {
        const { reprovadoPorIdioma } = await extrairUmVideo(video, linhaNicho.nome, linhaNicho.termos);
        videosAnalisados += 1;
        algumAnalisado = true;
        if (reprovadoPorIdioma) reprovadosPorIdioma += 1;
      } catch (erro) {
        erros.push(`setor "${nicho.slug}", video ${video.id}: ${erro instanceof Error ? erro.message : String(erro)}`);
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
        setoresComTemaEnfileirado += 1;
      } catch (erro) {
        logger.error({ err: erro, nichoId: nicho.id }, "nao foi possivel enfileirar temas-do-dia depois da analise imediata");
      }
    }
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
