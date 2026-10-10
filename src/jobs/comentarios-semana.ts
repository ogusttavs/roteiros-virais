/**
 * Job `comentariosSemana` (E28, semanal, domingo 04:45, depois de `pontuar` e antes de `analisarVisual`): a quarta camada de análise.
 * Por setor, os vídeos do YouTube mais vistos dos últimos `comentariosJanelaDias` dias, acima do piso do setor e com comentários de
 * verdade (`comentariosMinimoNoVideo`), ainda sem leitura. Para cada um: a primeira página dos comentários pela relevância do
 * YouTube (1 unidade da cota), o texto limpo de nome e de endereço (`lib/comentarios.ts`) gravado em `comentarios_video`, e a
 * leitura barata (`lerComentarios`) gravada em `videos.comentarios_analise`. No fim, uma junção por setor (`juntarVozes`) refaz
 * `nichos.vozes`: as perguntas, as reclamações e os pedidos da semana, com a soma dos comentários que diziam cada coisa.
 *
 * Só YouTube: a API da Meta não devolve o texto dos comentários de vídeo de outra conta (a Business Discovery só traz a contagem), e
 * o TikTok pelo Apify está suspenso (decisão do Gustavo, 09/09/2026). O vídeo com os comentários desligados é marcado e não volta.
 *
 * Cota: cada leitura é contada antes da chamada (a API desconta mesmo quando falha). O teto é o da coleta mais uma reserva pequena
 * só para isto: a coleta das 03:00 pode ter chegado ao limite dela, e vinte leituras por setor não podem ficar sem cota por isso.
 * Custo da IA: uma chamada barata por vídeo e uma por setor.
 */
import { and, desc, eq, gte, isNotNull, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { comentariosVideo, nichos, videos, type ComentariosAnalise } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as juntarVozesIA from "@/ia/prompts/juntarVozes";
import * as lerComentariosIA from "@/ia/prompts/lerComentarios";
import { registrarGeracao } from "@/ia/registro";
import { config } from "@/lib/config";
import { logger } from "@/lib/log";
import {
  conferirLeitura,
  conferirVozes,
  itensParaJuntar,
  montarVozes,
  vozesSemOModelo,
  type ComentarioNumerado,
} from "@/servicos/comentarios-do-publico";
import { normalizarComentariosYoutube } from "@/servicos/normalizadores/comentarios-youtube";
import { incluirSeed, PERTENCE_AO_NICHO, reguaDoSetor } from "@/servicos/pesquisa";

import { consumoDeHoje, LIMITE_DIARIO_UNIDADES, registrarConsumo } from "./coleta-youtube";
import { buscarComentariosDoVideo, CUSTO_LISTA, motivoDaFalhaDosComentarios } from "./youtube-api";

/** A reserva da cota para esta rotina, acima do limite diário da coleta (9 mil de 10 mil: sobram mil). */
export const RESERVA_DE_COTA_DOS_COMENTARIOS = 300;
/** Abaixo disto de comentário limpo, não há o que ler: o vídeo é marcado e não volta. */
export const MINIMO_DE_COMENTARIOS_PARA_LER = 10;
const DIA_MS = 24 * 60 * 60 * 1000;

type DepsComentarios = {
  agora?: Date;
  /** Os testes entregam a resposta gravada em vez de chamar a API (e ligam o job sem chave do YouTube). */
  buscarComentarios?: (videoId: string, maximo: number) => Promise<{ items?: unknown[] }>;
};

type VideoParaLer = { id: number; idExterno: string; titulo: string | null };

async function videosParaLer(nichoId: number, agora: Date): Promise<VideoParaLer[]> {
  const regua = await reguaDoSetor(nichoId);
  const condicoes = [
    eq(videos.nichoId, nichoId),
    eq(videos.plataforma, "youtube"),
    isNull(videos.comentariosColetadosEm),
    gte(videos.publicadoEm, new Date(agora.getTime() - config.regras.comentariosJanelaDias * DIA_MS)),
    gte(videos.views, regua.pisoViews),
    gte(videos.comentarios, config.regras.comentariosMinimoNoVideo),
    PERTENCE_AO_NICHO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));
  return db()
    .select({ id: videos.id, idExterno: videos.idExterno, titulo: videos.titulo })
    .from(videos)
    .where(and(...condicoes))
    .orderBy(desc(videos.views), videos.id)
    .limit(config.regras.comentariosVideosPorSemana);
}

type Desfecho = "lido" | "desligados" | "poucos" | "falhou" | "cota";

async function lerUm(video: VideoParaLer, setor: string, nichoId: number, contexto: { agora: Date; unidades: { usadas: number }; deps: DepsComentarios }): Promise<{ desfecho: Desfecho; comentarios: number; erro?: string }> {
  const { agora, unidades, deps } = contexto;
  const limite = LIMITE_DIARIO_UNIDADES + RESERVA_DE_COTA_DOS_COMENTARIOS;

  // A cota é contada antes da chamada (a API desconta mesmo quando falha), com a resposta gravada ou com a de verdade.
  if (unidades.usadas + CUSTO_LISTA > limite) return { desfecho: "cota", comentarios: 0 };
  unidades.usadas += CUSTO_LISTA;
  await registrarConsumo(CUSTO_LISTA);

  let resposta: { items?: unknown[] };
  try {
    resposta = await (deps.buscarComentarios ?? buscarComentariosDoVideo)(video.idExterno, config.regras.comentariosPorVideo);
  } catch (erro) {
    const motivo = motivoDaFalhaDosComentarios(erro);
    if (motivo === "cota") return { desfecho: "cota", comentarios: 0, erro: erro instanceof Error ? erro.message : String(erro) };
    if (motivo === "desligados") {
      await db().update(videos).set({ comentariosColetadosEm: agora }).where(eq(videos.id, video.id));
      return { desfecho: "desligados", comentarios: 0 };
    }
    return { desfecho: "falhou", comentarios: 0, erro: erro instanceof Error ? erro.message : String(erro) };
  }

  const comentarios = normalizarComentariosYoutube(resposta, config.regras.comentariosPorVideo);
  if (comentarios.length > 0) {
    await db()
      .insert(comentariosVideo)
      .values(comentarios.map((c) => ({ videoId: video.id, idExterno: c.idExterno, texto: c.texto, curtidas: c.curtidas, publicadoEm: c.publicadoEm, coletadoEm: agora })))
      .onConflictDoNothing();
  }
  if (comentarios.length < MINIMO_DE_COMENTARIOS_PARA_LER) {
    await db().update(videos).set({ comentariosColetadosEm: agora }).where(eq(videos.id, video.id));
    return { desfecho: "poucos", comentarios: comentarios.length };
  }

  const numerados: ComentarioNumerado[] = comentarios.map((c, i) => ({ numero: i + 1, texto: c.texto, curtidas: c.curtidas }));
  let resultado;
  try {
    resultado = await gerarEstruturado({
      tarefa: "lerComentarios",
      nivel: lerComentariosIA.nivel,
      effort: lerComentariosIA.esforco,
      schema: lerComentariosIA.schema,
      sistemaEstavel: lerComentariosIA.montarSistemaEstavel(),
      entrada: lerComentariosIA.montarEntrada({ titulo: video.titulo ?? "", setor, comentarios: numerados }),
    });
  } catch (erro) {
    // Os comentários já estão guardados; o vídeo não é marcado, e a próxima rodada lê de novo (a leitura é a parte barata).
    return { desfecho: "falhou", comentarios: comentarios.length, erro: erro instanceof Error ? erro.message : String(erro) };
  }

  const analise: ComentariosAnalise = conferirLeitura(resultado.dados, numerados);
  await db().update(videos).set({ comentariosAnalise: analise, comentariosColetadosEm: agora }).where(eq(videos.id, video.id));
  await registrarGeracao({
    tarefa: "lerComentarios",
    versaoPrompt: lerComentariosIA.versao,
    modelo: resultado.modelo,
    nivel: lerComentariosIA.nivel,
    entradas: { videoId: video.id, nichoId, comentarios: numerados.length },
    saida: analise,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
  });
  return { desfecho: "lido", comentarios: comentarios.length };
}

/** Refaz `nichos.vozes` com as leituras da semana. Sem nenhuma leitura nova, deixa a anterior como está (ela mesma envelhece, pela data). */
async function refazerVozes(nicho: { id: number; nome: string }, agora: Date): Promise<{ refeitas: boolean; videos: number; comentarios: number; porModelo: boolean }> {
  const desde = new Date(agora.getTime() - config.regras.comentariosJanelaDias * DIA_MS);
  const linhas = await db()
    .select({ videoId: videos.id, analise: videos.comentariosAnalise })
    .from(videos)
    .where(and(eq(videos.nichoId, nicho.id), isNotNull(videos.comentariosAnalise), gte(videos.comentariosColetadosEm, desde)));
  const leituras = linhas.filter((l): l is { videoId: number; analise: ComentariosAnalise } => l.analise !== null);
  if (leituras.length === 0) return { refeitas: false, videos: 0, comentarios: 0, porModelo: false };

  const itens = itensParaJuntar(leituras);
  const totais = { videos: leituras.length, comentarios: leituras.reduce((soma, l) => soma + l.analise.lidos, 0) };

  let juntas = vozesSemOModelo(itens);
  let porModelo = false;
  // Com zero ou um item não há o que juntar: poupa a chamada.
  if (itens.length > 1) {
    try {
      const resultado = await gerarEstruturado({
        tarefa: "juntarVozes",
        nivel: juntarVozesIA.nivel,
        effort: juntarVozesIA.esforco,
        schema: juntarVozesIA.schema,
        sistemaEstavel: juntarVozesIA.montarSistemaEstavel(),
        entrada: juntarVozesIA.montarEntrada({ setor: nicho.nome, itens: itens.map((i) => ({ numero: i.numero, tipo: i.tipo, texto: i.texto })) }),
      });
      await registrarGeracao({
        tarefa: "juntarVozes",
        versaoPrompt: juntarVozesIA.versao,
        modelo: resultado.modelo,
        nivel: juntarVozesIA.nivel,
        entradas: { nichoId: nicho.id, itens: itens.length },
        saida: resultado.dados,
        uso: {
          tokensEntrada: resultado.tokensEntrada,
          tokensSaida: resultado.tokensSaida,
          tokensCacheLeitura: resultado.tokensCacheLeitura,
          tokensCacheEscrita: resultado.tokensCacheEscrita,
        },
      });
      juntas = conferirVozes(resultado.dados, itens);
      porModelo = true;
    } catch (erro) {
      logger.warn({ err: erro, nichoId: nicho.id }, "nao foi possivel juntar as vozes do publico com o modelo; so o que esta escrito igual e junto");
    }
  }

  await db()
    .update(nichos)
    .set({ vozes: montarVozes(juntas, totais), vozesEm: agora })
    .where(eq(nichos.id, nicho.id));
  return { refeitas: true, videos: totais.videos, comentarios: totais.comentarios, porModelo };
}

export async function rodarComentariosSemana(nichoId?: number, deps: DepsComentarios = {}): Promise<Record<string, unknown>> {
  const agora = deps.agora ?? new Date();
  if (!deps.buscarComentarios && !config.coleta.youtubeKey) {
    return { semChaveDoYoutube: true };
  }

  const condicao = nichoId ? and(eq(nichos.ativo, true), eq(nichos.id, nichoId)) : eq(nichos.ativo, true);
  const nichosAtivos = await db().select({ id: nichos.id, slug: nichos.slug, nome: nichos.nome }).from(nichos).where(condicao);

  const unidades = { usadas: await consumoDeHoje() };
  const contagem = { lidos: 0, desligados: 0, poucos: 0, falhas: 0, comentariosGuardados: 0 };
  const erros: string[] = [];
  const avisos: string[] = [];
  const vozes: Record<string, unknown>[] = [];
  let semCota = false;

  for (const nicho of nichosAtivos) {
    if (!semCota) {
      const candidatos = await videosParaLer(nicho.id, agora);
      for (const video of candidatos) {
        const feito = await lerUm(video, nicho.nome, nicho.id, { agora, unidades, deps });
        contagem.comentariosGuardados += feito.comentarios;
        if (feito.desfecho === "lido") contagem.lidos += 1;
        else if (feito.desfecho === "desligados") contagem.desligados += 1;
        else if (feito.desfecho === "poucos") contagem.poucos += 1;
        else if (feito.desfecho === "falhou") {
          contagem.falhas += 1;
          erros.push(`video ${video.id} / setor "${nicho.slug}": ${feito.erro ?? "falhou"}`);
        } else {
          semCota = true;
          avisos.push("a cota do YouTube de hoje acabou: o resto fica para a próxima rodada");
          break;
        }
      }
    }

    try {
      const refeitas = await refazerVozes(nicho, agora);
      if (refeitas.refeitas) vozes.push({ setor: nicho.slug, ...refeitas });
    } catch (erro) {
      contagem.falhas += 1;
      erros.push(`vozes do setor "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  return {
    nichos: nichosAtivos.length,
    ...contagem,
    unidadesDeCotaHoje: unidades.usadas,
    vozes: vozes.length > 0 ? vozes : undefined,
    avisos: avisos.length > 0 ? avisos : undefined,
    erros: erros.length > 0 ? erros : undefined,
  };
}
