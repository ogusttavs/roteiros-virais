/**
 * E52 (PR 1), o vídeo longo do YouTube: o que o banco já sabe dos longos do setor, sem transcrever nenhum. O produto até aqui é vídeo curto (o teto de 180 s,
 * `DENTRO_DO_TETO_DE_DURACAO`, tira o longo de Referências, dos temas e da fila de transcrição); a E52 olha o outro lado do mesmo corte: acima de 180 s e até
 * `videoLongoMaxS`, só YouTube (o Instagram e o TikTok não trazem a duração de forma confiável).
 *
 * Três coisas, todas por código e todas de graça (a API de dados do YouTube, cota gratuita, já traz título, descrição, duração e views de todo upload coletado):
 *
 * 1. `longosDoSetor`: os longos do setor acima do piso de views dele, os mais fora da curva primeiro, cada um com os capítulos que o dono escreveu na descrição
 *    (`lerCapitulosDaDescricao`).
 * 2. `medidaDosLongos`: a duração típica (percentis 25, 50 e 75) e a estrutura típica (quantos capítulos, de que tamanho) dos longos do setor, com o tamanho da amostra
 *    dito (a regra da base de plataformas: abaixo de 30 vídeos é indício, não regra; abaixo de 3, nada). É a "referência de duração que vem do banco, não de regra fixa".
 * 3. `longosParaLer`: quais longos ganham transcrição esta semana, no máximo `longosParaLerPorSemana` por setor (a transcrição de um longo custa dez vezes a de um curto),
 *    sem repetir quem já tem leitura ou está esperando a nova tentativa, e no máximo dois por conta na semana (o que já foi lido na semana conta para a conta dele).
 *
 * A leitura em si (a transcrição e a extração da estrutura) é o PR seguinte; este módulo só diz o que ler.
 */
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { contas, videos } from "@/db/schema";
import { type CapituloDaDescricao, lerCapitulosDaDescricao } from "@/lib/capitulos-da-descricao";
import { config } from "@/lib/config";

import { incluirSeed, PERTENCE_AO_NICHO, reguaDoSetor } from "./pesquisa";
import { classificarBrasil, contaEhBrasileira, type ClassificacaoBrasil } from "./proporcao-brasil";
import { MAX_POR_CONTA } from "./selecionar-transcricao";

const DIA_MS = 24 * 60 * 60 * 1000;
/**
 * A janela do que "já foi lido na semana". Seis dias, e não sete: a rotina é semanal (domingo de manhã) e o cron nasce segundos antes ou depois da hora da rodada anterior, então
 * com sete dias o que a rodada de domingo transcreveu ainda cairia dentro da janela da rodada do domingo seguinte e a semana renderia metade (achado da revisão do PR 2).
 */
const JANELA_DA_SEMANA_MS = 6 * DIA_MS;
/** A folga na data da nova tentativa: o vídeo que espera "até domingo que vem" volta no domingo que vem, mesmo que o cron nasça algumas horas antes da hora marcada. */
const FOLGA_DA_NOVA_TENTATIVA_MS = 6 * 60 * 60 * 1000;

/**
 * Acima do teto de duração dos curtos e até o limite do longo. Vídeo sem duração conhecida nunca é longo (o contrário do teto dos curtos, que o deixa passar): não dá
 * para dizer de que tamanho é, e a medida da duração precisa dela.
 */
export const CONDICAO_DE_VIDEO_LONGO = sql`(${videos.duracaoS} > ${config.regras.tetoDuracaoReferenciaS} and ${videos.duracaoS} <= ${config.regras.videoLongoMaxS})`;

export type VideoLongoDoSetor = {
  id: number;
  idExterno: string;
  url: string;
  titulo: string | null;
  views: number;
  duracaoS: number;
  publicadoEm: Date | null;
  foraDaCurva: number | null;
  contaId: number | null;
  classificacao: ClassificacaoBrasil;
  /** Os capítulos da descrição; vazio quando o dono não escreveu a lista. */
  capitulos: CapituloDaDescricao[];
  temTranscricao: boolean;
  proximaTentativaTranscricao: Date | null;
  /** A leitura da estrutura (`videos.analise_longa`, E52 PR 2) já existe. */
  temAnaliseLonga: boolean;
  proximaTentativaAnaliseLonga: Date | null;
};

type OpcoesDosLongos = {
  agora?: Date;
  /** A janela em dias; o padrão é a da lista (`longosJanelaDias`). */
  dias?: number;
  limite?: number;
};

/**
 * Os longos do setor, os mais fora da curva primeiro (e, no empate ou sem a medida da conta, os mais vistos). Só YouTube, do setor, acima do piso de views dele (a mesma
 * régua dos curtos: a decisão do Gustavo de 25/09 é de "referência", e o longo é uma), dentro da janela, sem o que a análise marcou como fora do setor e sem vídeo de seed
 * fora do desenvolvimento.
 */
export async function longosDoSetor(nichoId: number, opcoes: OpcoesDosLongos = {}): Promise<VideoLongoDoSetor[]> {
  const agora = opcoes.agora ?? new Date();
  const dias = opcoes.dias ?? config.regras.longosJanelaDias;
  const regua = await reguaDoSetor(nichoId);
  const condicoes = [
    eq(videos.nichoId, nichoId),
    eq(videos.plataforma, "youtube"),
    gte(videos.publicadoEm, new Date(agora.getTime() - dias * DIA_MS)),
    gte(videos.views, regua.pisoViews),
    PERTENCE_AO_NICHO,
    CONDICAO_DE_VIDEO_LONGO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const consulta = db()
    .select({
      id: videos.id,
      idExterno: videos.idExterno,
      url: videos.url,
      titulo: videos.titulo,
      descricao: videos.descricao,
      views: videos.views,
      duracaoS: videos.duracaoS,
      publicadoEm: videos.publicadoEm,
      foraDaCurva: videos.foraDaCurva,
      contaId: videos.contaId,
      idioma: videos.idioma,
      contaPais: contas.pais,
      contaIdiomaPrincipal: contas.idiomaPrincipal,
      temTranscricao: sql<boolean>`${videos.transcricao} is not null`,
      proximaTentativaTranscricao: videos.proximaTentativaTranscricao,
      temAnaliseLonga: sql<boolean>`${videos.analiseLonga} is not null`,
      proximaTentativaAnaliseLonga: videos.proximaTentativaAnaliseLonga,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(...condicoes))
    .orderBy(sql`${videos.foraDaCurva} desc nulls last`, desc(videos.views), videos.id);

  const linhas = opcoes.limite ? await consulta.limit(opcoes.limite) : await consulta;
  return linhas.map((l) => {
    // A condição já garante a duração; o tipo do banco ainda a diz nula.
    const duracaoS = l.duracaoS ?? 0;
    return {
      id: l.id,
      idExterno: l.idExterno,
      url: l.url,
      titulo: l.titulo,
      views: l.views,
      duracaoS,
      publicadoEm: l.publicadoEm,
      foraDaCurva: l.foraDaCurva === null ? null : Number(l.foraDaCurva),
      contaId: l.contaId,
      classificacao: classificarBrasil(l.idioma, contaEhBrasileira(l.contaPais, l.contaIdiomaPrincipal)),
      capitulos: lerCapitulosDaDescricao(l.descricao, duracaoS),
      temTranscricao: l.temTranscricao,
      proximaTentativaTranscricao: l.proximaTentativaTranscricao,
      temAnaliseLonga: l.temAnaliseLonga,
      proximaTentativaAnaliseLonga: l.proximaTentativaAnaliseLonga,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// A medida: o que o banco diz da duração e da estrutura dos longos do setor
// ---------------------------------------------------------------------------------------------------------------------

/** "regra" com 30 vídeos ou mais; "indicio" de 3 a 29; abaixo disso não há o que medir (a regra da base de plataformas, `GUIA.md`). */
export type ForcaDaMedida = "regra" | "indicio" | "nenhuma";

export const AMOSTRA_PARA_VIRAR_REGRA = 30;
export const AMOSTRA_MINIMA = 3;

export type MedidaDosLongos = {
  amostra: number;
  forca: ForcaDaMedida;
  /** Percentis 25, 50 e 75 da duração, em segundos; nulo sem amostra mínima. */
  duracaoS: { p25: number; mediana: number; p75: number } | null;
  /**
   * A estrutura que os donos escreveram na descrição: quantos vídeos têm a lista, quantos capítulos tem o vídeo típico e de que tamanho é o capítulo típico (todos os
   * capítulos juntos, o último medido até o fim do vídeo). Nulo com menos de `AMOSTRA_MINIMA` vídeos com lista. A `forca` é da estrutura, não da amostra da duração: 30
   * longos com 3 listas medem a duração com força de regra e a estrutura só como indício.
   */
  capitulos: { videosComLista: number; quantidadeMediana: number; tamanhoMedianoS: number; forca: Exclude<ForcaDaMedida, "nenhuma"> } | null;
  /** Os títulos dos mais vistos, para o prompt ver como o setor nomeia um vídeo longo (até 8). */
  titulos: string[];
};

/** Percentil por interpolação linear entre as posições vizinhas, arredondado ao segundo. A lista tem de vir ordenada. */
function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 1) return ordenados[0];
  const posicao = (ordenados.length - 1) * p;
  const baixo = Math.floor(posicao);
  const alto = Math.ceil(posicao);
  return Math.round(ordenados[baixo] + (ordenados[alto] - ordenados[baixo]) * (posicao - baixo));
}

function mediana(valores: number[]): number {
  return percentil([...valores].sort((a, b) => a - b), 0.5);
}

/** Pura: mede uma lista de longos já carregada. O que não é do setor em português ("outro") fica de fora da medida. */
export function medirOsLongos(longos: VideoLongoDoSetor[]): MedidaDosLongos {
  const doSetor = longos.filter((v) => v.classificacao !== "outro");
  const amostra = doSetor.length;
  const forca: ForcaDaMedida = amostra >= AMOSTRA_PARA_VIRAR_REGRA ? "regra" : amostra >= AMOSTRA_MINIMA ? "indicio" : "nenhuma";

  const titulos = [...doSetor]
    .sort((a, b) => b.views - a.views || a.id - b.id)
    .map((v) => v.titulo?.trim() ?? "")
    .filter((t) => t !== "")
    .slice(0, 8);

  if (forca === "nenhuma") return { amostra, forca, duracaoS: null, capitulos: null, titulos };

  const duracoes = doSetor.map((v) => v.duracaoS).sort((a, b) => a - b);
  const duracaoS = { p25: percentil(duracoes, 0.25), mediana: percentil(duracoes, 0.5), p75: percentil(duracoes, 0.75) };

  const comLista = doSetor.filter((v) => v.capitulos.length > 0);
  let capitulos: MedidaDosLongos["capitulos"] = null;
  if (comLista.length >= AMOSTRA_MINIMA) {
    const tamanhos: number[] = [];
    for (const v of comLista) {
      v.capitulos.forEach((c, i) => {
        const fim = i + 1 < v.capitulos.length ? v.capitulos[i + 1].inicioS : v.duracaoS;
        tamanhos.push(Math.max(0, fim - c.inicioS));
      });
    }
    capitulos = {
      videosComLista: comLista.length,
      quantidadeMediana: mediana(comLista.map((v) => v.capitulos.length)),
      tamanhoMedianoS: mediana(tamanhos),
      forca: comLista.length >= AMOSTRA_PARA_VIRAR_REGRA ? "regra" : "indicio",
    };
  }

  return { amostra, forca, duracaoS, capitulos, titulos };
}

/** A medida dos longos do setor na janela larga (`longosMedidaJanelaDias`): a amostra é pequena, então olha mais para trás que a lista. */
export async function medidaDosLongos(nichoId: number, agora: Date = new Date()): Promise<MedidaDosLongos> {
  const longos = await longosDoSetor(nichoId, { agora, dias: config.regras.longosMedidaJanelaDias });
  return medirOsLongos(longos);
}

// ---------------------------------------------------------------------------------------------------------------------
// O que ler: os poucos longos da semana que ganham transcrição
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Pura: dos longos (já ordenados por prioridade), os que ganham leitura agora. Fora quem já tem transcrição, quem espera a nova tentativa e o que é "outro" (a mesma
 * regra da fila dos curtos, sem a proporção do Brasil); no máximo `MAX_POR_CONTA` por conta; no máximo o que sobra do orçamento da semana (`porSemana` menos o que já foi lido
 * nos últimos sete dias). `tetoDeMinutos`, quando dado, é o teto de duração transcrita na semana (a transcrição de um longo de 40 minutos custa e demora): o longo que não cabe no
 * que sobra fica de fora e o seguinte da fila, mais curto, pode caber.
 */
export function escolherLongosParaLer(longos: VideoLongoDoSetor[], lidos: LidosNaSemana, porSemana: number, agora: Date, tetoDeMinutos?: number): number[] {
  const vagas = Math.max(0, porSemana - lidos.total);
  if (vagas === 0) return [];
  const escolhidos: number[] = [];
  let minutos = lidos.minutos;
  // O teto por conta é da semana, não da rodada: quem já foi lido nos últimos sete dias gasta a vaga da conta dele (senão a mesma conta ganharia duas vagas novas por dia).
  const porConta = new Map(lidos.porConta);
  for (const v of longos) {
    if (escolhidos.length >= vagas) break;
    if (v.temTranscricao || v.classificacao === "outro") continue;
    if (v.proximaTentativaTranscricao && v.proximaTentativaTranscricao.getTime() > agora.getTime() + FOLGA_DA_NOVA_TENTATIVA_MS) continue;
    const duracaoMin = v.duracaoS / 60;
    if (tetoDeMinutos !== undefined && minutos + duracaoMin > tetoDeMinutos) continue;
    if (v.contaId !== null) {
      const usadas = porConta.get(v.contaId) ?? 0;
      if (usadas >= MAX_POR_CONTA) continue;
      porConta.set(v.contaId, usadas + 1);
    }
    minutos += duracaoMin;
    escolhidos.push(v.id);
  }
  return escolhidos;
}

/** O que já gastou do orçamento da semana: quantos longos do setor ganharam transcrição nos últimos seis dias, de quais contas e quantos minutos de vídeo. */
export type LidosNaSemana = { total: number; porConta: Map<number, number>; minutos: number };

export async function longosLidosNaSemana(nichoId: number, agora: Date = new Date()): Promise<LidosNaSemana> {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    eq(videos.plataforma, "youtube"),
    CONDICAO_DE_VIDEO_LONGO,
    gte(videos.transcritoEm, new Date(agora.getTime() - JANELA_DA_SEMANA_MS)),
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));
  const linhas = await db()
    .select({ contaId: videos.contaId, n: sql<number>`count(*)::int`, segundos: sql<number>`coalesce(sum(${videos.duracaoS}), 0)::int` })
    .from(videos)
    .where(and(...condicoes))
    .groupBy(videos.contaId);
  const porConta = new Map<number, number>();
  let total = 0;
  let segundos = 0;
  for (const l of linhas) {
    total += l.n;
    segundos += l.segundos;
    if (l.contaId !== null) porConta.set(l.contaId, l.n);
  }
  return { total, porConta, minutos: segundos / 60 };
}

/** Os ids dos longos do setor que a rodada desta semana deve transcrever, no máximo o que sobra de `longosParaLerPorSemana`. */
export async function longosParaLer(nichoId: number, agora: Date = new Date()): Promise<number[]> {
  const lidos = await longosLidosNaSemana(nichoId, agora);
  if (lidos.total >= config.regras.longosParaLerPorSemana) return [];
  const longos = await longosDoSetor(nichoId, { agora });
  return escolherLongosParaLer(longos, lidos, config.regras.longosParaLerPorSemana, agora, config.regras.longosMinutosPorSemana);
}
