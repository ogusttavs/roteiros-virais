/**
 * E17 parte 1: guarda o vetor (embedding) da ficha de cada vídeo analisado, para a busca por significado (`servicos/busca-por-significado.ts`). É o que o job `embedar-videos` roda.
 *
 * Quem entra: vídeo com análise, dos últimos 90 dias (a janela da evidência), sem vetor do modelo atual ou com a ficha mudada (o hash do texto embedado difere do guardado). Os mais recentes primeiro.
 *
 * Três tetos, todos para o job nunca gastar sem querer: vídeos por rodada (`EMBEDDINGS_VIDEOS_POR_RODADA`), dólares por dia somados de `custos_externos` (`EMBEDDINGS_TETO_USD_DIA`) e a primeira
 * falha da API (a rodada seguinte retoma sozinha, porque a seleção é "o que ainda não tem vetor"). Cada lote grava o custo (`fonte = "voyage"`, em tokens) antes do lote seguinte começar.
 * Recusa gravar vetor simulado em produção.
 */
import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { custosExternos, embeddingsVideo, videos } from "@/db/schema";
import { config, hojeISO } from "@/lib/config";
import { estimarTokens, hashDaFicha, portaEmbeddings, type PortaEmbeddings } from "@/lib/embeddings";
import { logger } from "@/lib/log";
import { custoDosVetoresUsd, registrarCustoExterno } from "@/servicos/custos-externos";
import { incluirSeed } from "@/servicos/pesquisa";

const DIA_MS = 24 * 60 * 60 * 1000;
/** A mesma janela da evidência (`condicoesBaseDaEvidencia`, 90 dias): vídeo mais velho nunca é evidência, então não ganha vetor. */
export const JANELA_DOS_VETORES_DIAS = 90;
/** O teto de caracteres da ficha: o suficiente para título, assunto, gancho e etiquetas; mantém o custo por vídeo previsível. */
const MAX_CARACTERES_DA_FICHA = 1200;

export type CamposDaFicha = { titulo: string | null; assunto: string | null; gancho: string | null; etiquetas: string[] | null };

/** O texto que representa o vídeo para a busca por significado. Só o que descreve o assunto: nada de transcrição inteira (custo e ruído). */
export function fichaDoVideo(v: CamposDaFicha): string {
  const partes = [v.titulo, v.assunto, v.gancho, (v.etiquetas ?? []).join(", ")].map((p) => (p ?? "").trim()).filter((p) => p !== "");
  return partes.join("\n").slice(0, MAX_CARACTERES_DA_FICHA);
}

export type ResumoDoPreenchimento = {
  desligado: boolean;
  modelo: string;
  /** Vídeos dentro da janela com análise. */
  elegiveis: number;
  /** Vídeos que já tinham o vetor certo (nada a fazer). */
  jaTinham: number;
  /** Vídeos que precisavam de vetor nesta rodada (antes dos tetos). */
  precisavam: number;
  /** Vetores gravados agora. */
  gravados: number;
  tokens: number;
  custoUsd: number;
  parouPor: "nada_a_fazer" | "teto_por_rodada" | "teto_de_dolar" | "falha" | "concluido";
  erro?: string;
};

export type OpcoesDoPreenchimento = {
  porta?: PortaEmbeddings;
  agora?: Date;
  videosPorRodada?: number;
  tetoUsdPorDia?: number;
  textosPorChamada?: number;
};

/** Quanto já se gastou hoje (dia do Brasil) com a Voyage, em dólar. */
export async function gastoDeHojeUsd(agora: Date): Promise<number> {
  const [linha] = await db()
    .select({ total: sql<string>`coalesce(sum(${custosExternos.custoUsd}), 0)::text` })
    .from(custosExternos)
    .where(and(eq(custosExternos.fonte, "voyage"), sql`(${custosExternos.criadoEm} at time zone 'America/Sao_Paulo')::date = ${hojeISO(agora)}::date`));
  return Number(linha?.total ?? 0);
}

function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

export async function preencherVetores(opcoes: OpcoesDoPreenchimento = {}): Promise<ResumoDoPreenchimento> {
  const porta = opcoes.porta ?? portaEmbeddings();
  const agora = opcoes.agora ?? new Date();
  const teto = Math.max(0, Math.floor(opcoes.videosPorRodada ?? config.embeddings.videosPorRodada));
  const tetoUsd = opcoes.tetoUsdPorDia ?? config.embeddings.tetoUsdPorDia;
  const porChamada = Math.max(1, Math.floor(opcoes.textosPorChamada ?? config.embeddings.textosPorChamada));

  const resumo: ResumoDoPreenchimento = { desligado: false, modelo: porta.modelo, elegiveis: 0, jaTinham: 0, precisavam: 0, gravados: 0, tokens: 0, custoUsd: 0, parouPor: "concluido" };

  if (porta.simulada && process.env.NODE_ENV === "production") {
    throw new Error("embedar-videos recusa gravar vetor simulado em producao (EMBEDDINGS_PROVIDER=voyage com VOYAGE_API_KEY).");
  }

  const candidatos = await db()
    .select({
      id: videos.id,
      titulo: videos.titulo,
      assunto: sql<string | null>`${videos.analise} ->> 'assunto'`,
      gancho: sql<string | null>`${videos.analise} ->> 'gancho'`,
      etiquetas: videos.etiquetas,
      hashGuardado: embeddingsVideo.fichaHash,
    })
    .from(videos)
    .leftJoin(embeddingsVideo, and(eq(embeddingsVideo.videoId, videos.id), eq(embeddingsVideo.modelo, porta.modelo)))
    .where(
      and(
        sql`${videos.analise} is not null`,
        gte(videos.publicadoEm, new Date(agora.getTime() - JANELA_DOS_VETORES_DIAS * DIA_MS)),
        incluirSeed() ? undefined : sql`${videos.origem} <> 'seed'`,
      ),
    )
    .orderBy(sql`${videos.publicadoEm} desc`, sql`${videos.id} desc`);

  resumo.elegiveis = candidatos.length;
  const pendentes = candidatos
    .map((c) => {
      const ficha = fichaDoVideo(c);
      return { id: c.id, ficha, hash: hashDaFicha(ficha, porta.modelo), hashGuardado: c.hashGuardado };
    })
    .filter((c) => c.ficha !== "" && c.hash !== c.hashGuardado);
  resumo.jaTinham = candidatos.length - pendentes.length;
  resumo.precisavam = pendentes.length;

  if (pendentes.length === 0) {
    resumo.parouPor = "nada_a_fazer";
    return resumo;
  }

  let aFazer = pendentes;
  if (aFazer.length > teto) {
    aFazer = aFazer.slice(0, teto);
    resumo.parouPor = "teto_por_rodada";
  }

  for (const lote of emLotes(aFazer, porChamada)) {
    // O teto de dólar olha o que já foi gasto hoje MAIS o que este lote custaria (estimado antes de chamar), para nunca passar dele.
    const estimativa = custoDosVetoresUsd(lote.reduce((soma, c) => soma + estimarTokens(c.ficha), 0));
    if ((await gastoDeHojeUsd(agora)) + estimativa > tetoUsd) {
      resumo.parouPor = "teto_de_dolar";
      break;
    }
    let resposta;
    try {
      resposta = await porta.embedar(
        lote.map((c) => c.ficha),
        "documento",
      );
    } catch (erro) {
      resumo.parouPor = "falha";
      resumo.erro = erro instanceof Error ? erro.message : String(erro);
      logger.warn({ err: erro, gravadosAteAqui: resumo.gravados }, "embedar-videos parou na primeira falha da API; a proxima rodada retoma");
      break;
    }
    await db()
      .insert(embeddingsVideo)
      .values(lote.map((c, i) => ({ videoId: c.id, modelo: porta.modelo, fichaHash: c.hash, vetor: resposta.vetores[i] })))
      .onConflictDoUpdate({
        target: [embeddingsVideo.videoId, embeddingsVideo.modelo],
        set: { fichaHash: sql`excluded.ficha_hash`, vetor: sql`excluded.vetor`, criadoEm: sql`now()` },
      });
    const custoUsd = custoDosVetoresUsd(resposta.tokens);
    await registrarCustoExterno({
      fonte: "voyage",
      custoUsd,
      unidades: resposta.tokens,
      unidade: "tokens",
      origemDoCusto: "estimado",
      detalhe: { modelo: porta.modelo, uso: "videos", textos: lote.length },
    });
    resumo.gravados += lote.length;
    resumo.tokens += resposta.tokens;
    resumo.custoUsd += custoUsd;
  }

  resumo.custoUsd = Number(resumo.custoUsd.toFixed(6));
  return resumo;
}
