/**
 * Consultas prontas sobre o que o job `pontuar` calculou (etapa 7, decisão 6
 * do `PROXIMO.md`): o que está fora da curva no nicho, e o que está subindo
 * hoje. São as consultas que as etapas 8, 9 e 10 vão usar para escolher o
 * que transcrever, extrair e citar como evidência no tema e no roteiro; por
 * enquanto também alimentam `/admin/nichos/[slug]`.
 *
 * Fora de desenvolvimento, vídeo de seed nunca aparece (regra do
 * `plataforma/CLAUDE.md`: "toda consulta de produto filtra origem <> seed
 * fora de desenvolvimento"). As duas ordenam de forma determinística
 * (desempate por id), para a mesma consulta não devolver ordens diferentes
 * em execuções iguais.
 */
import { and, asc, desc, eq, gte, isNotNull, lte, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { contas, modelosNicho, videos, type AnaliseVideo, type ModeloNicho, type Plataforma } from "@/db/schema";

export type ModeloNichoLinha = typeof modelosNicho.$inferSelect;

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

export type VideoRankeado = {
  id: number;
  plataforma: Plataforma;
  url: string;
  titulo: string | null;
  contaHandle: string | null;
  views: number;
  foraDaCurva: number | null;
  velocidade: number | null;
  velocidadeRelativa: number | null;
  publicadoEm: Date | null;
};

/**
 * Fora de desenvolvimento, vídeo de seed nunca aparece (regra do
 * `plataforma/CLAUDE.md`). Exportada para os jobs de nicho (etapa 9, base
 * lenta) aplicarem o mesmo filtro nas próprias consultas.
 */
export function incluirSeed(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * A vigilância (etapa 7) escolhe conta, não assunto: tudo que a conta posta
 * entra na coleta. `extrairVideo` (etapa 10, ajuste da revisão da etapa 9)
 * marca `pertenceAoNicho` na análise; aqui exclui só o que foi marcado como
 * `false`. Vídeo sem análise, ou com análise anterior a esse campo (não tem
 * a chave), continua contando, "is distinct from" trata os dois casos como
 * não-falso sem precisar de um OR à parte. Exportada para `analisarVisual` e
 * `modeloNicho` (etapa 9) aplicarem o mesmo filtro nas próprias consultas.
 */
export const PERTENCE_AO_NICHO = sql`(${videos.analise} ->> 'pertenceAoNicho') is distinct from 'false'`;

function mapear(linha: {
  id: number;
  plataforma: Plataforma;
  url: string;
  titulo: string | null;
  contaHandle: string | null;
  views: number;
  foraDaCurva: string | null;
  velocidade: string | null;
  velocidadeRelativa: string | null;
  publicadoEm: Date | null;
}): VideoRankeado {
  return {
    ...linha,
    foraDaCurva: linha.foraDaCurva === null ? null : Number(linha.foraDaCurva),
    velocidade: linha.velocidade === null ? null : Number(linha.velocidade),
    velocidadeRelativa: linha.velocidadeRelativa === null ? null : Number(linha.velocidadeRelativa),
  };
}

const COLUNAS = {
  id: videos.id,
  plataforma: videos.plataforma,
  url: videos.url,
  titulo: videos.titulo,
  contaHandle: contas.handle,
  views: videos.views,
  foraDaCurva: videos.foraDaCurva,
  velocidade: videos.velocidade,
  velocidadeRelativa: videos.velocidadeRelativa,
  publicadoEm: videos.publicadoEm,
};

/** O que está fora da curva no nicho nos últimos `dias` dias (escopo 5.1). */
export async function foraDaCurvaDoNicho(
  nichoId: number,
  dias = 90,
  limite?: number,
): Promise<VideoRankeado[]> {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, diasAtras(dias)),
    isNotNull(videos.foraDaCurva),
    PERTENCE_AO_NICHO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const consulta = db()
    .select(COLUNAS)
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(...condicoes))
    .orderBy(desc(videos.foraDaCurva), asc(videos.id));

  const linhas = limite ? await consulta.limit(limite) : await consulta;
  return linhas.map(mapear);
}

/** O que está subindo hoje no nicho: 2 a 7 dias, por velocidade relativa (escopo 5.1). */
export async function subindoHoje(nichoId: number, limite?: number): Promise<VideoRankeado[]> {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    lte(videos.publicadoEm, diasAtras(2)),
    gte(videos.publicadoEm, diasAtras(7)),
    isNotNull(videos.velocidadeRelativa),
    PERTENCE_AO_NICHO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const consulta = db()
    .select(COLUNAS)
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(...condicoes))
    .orderBy(desc(videos.velocidadeRelativa), asc(videos.id));

  const linhas = limite ? await consulta.limit(limite) : await consulta;
  return linhas.map(mapear);
}

export type VideoComAssunto = { id: number; assunto: string; velocidadeRelativa: number };

/**
 * `subindoHoje` com o assunto da análise, para o job `temasDoDia` (etapa 10,
 * decisão 2 do `PROXIMO.md`) citar como evidência. Só vídeo já extraído
 * conta; sem `analise` não tem assunto para o tema descrever.
 */
export async function subindoHojeComAnalise(nichoId: number, limite = 30): Promise<VideoComAssunto[]> {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    lte(videos.publicadoEm, diasAtras(2)),
    gte(videos.publicadoEm, diasAtras(7)),
    isNotNull(videos.velocidadeRelativa),
    isNotNull(videos.analise),
    PERTENCE_AO_NICHO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const linhas = await db()
    .select({ id: videos.id, analise: videos.analise, velocidadeRelativa: videos.velocidadeRelativa })
    .from(videos)
    .where(and(...condicoes))
    .orderBy(desc(videos.velocidadeRelativa), asc(videos.id))
    .limit(limite);

  return linhas
    .filter((l): l is typeof l & { analise: AnaliseVideo } => l.analise !== null)
    .map((l) => ({
      id: l.id,
      assunto: l.analise.assunto,
      velocidadeRelativa: l.velocidadeRelativa === null ? 0 : Number(l.velocidadeRelativa),
    }));
}

/** Palavras com 4 ou mais letras do texto do tema, sem repetir (etapa 10). */
export function palavrasChave(texto: string): string[] {
  const encontradas = texto.toLowerCase().match(/\p{L}{4,}/gu) ?? [];
  return [...new Set(encontradas)];
}

export type VideoEvidenciaTema = { id: number; assunto: string; foraDaCurva: number };

/**
 * Evidência de um tema proposto pelo cliente (etapa 10, decisão 5 do
 * `PROXIMO.md`): casa pela busca textual (`videos.busca`, gerada com título,
 * descrição, transcrição e assunto) ou por etiqueta que contenha alguma
 * palavra do texto, nos últimos 90 dias, os de maior `fora_da_curva`
 * primeiro. Sem palavra nem casamento textual, a lista vem vazia (o prompt
 * já sabe dizer "sem evidência" para isso).
 */
export async function evidenciaParaTema(nichoId: number, texto: string, limite = 8): Promise<VideoEvidenciaTema[]> {
  const palavras = palavrasChave(texto);
  // "?|" pede um text[] de verdade; um array JS interpolado direto vira uma
  // lista de parametros separados por virgula, que o Postgres le como um
  // record (erro "cannot cast type record to text[]"), nao como array.
  const palavrasSql =
    palavras.length > 0
      ? sql`array[${sql.join(
          palavras.map((p) => sql`${p}`),
          sql`, `,
        )}]::text[]`
      : sql`array[]::text[]`;
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, diasAtras(90)),
    isNotNull(videos.analise),
    PERTENCE_AO_NICHO,
    sql`(${videos.busca} @@ plainto_tsquery('portuguese', ${texto}) or ${videos.etiquetas} ?| ${palavrasSql})`,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const linhas = await db()
    .select({ id: videos.id, analise: videos.analise, foraDaCurva: videos.foraDaCurva })
    .from(videos)
    .where(and(...condicoes))
    .orderBy(desc(videos.foraDaCurva), asc(videos.id))
    .limit(limite);

  return linhas
    .filter((l): l is typeof l & { analise: AnaliseVideo } => l.analise !== null)
    .map((l) => ({
      id: l.id,
      assunto: l.analise.assunto,
      foraDaCurva: l.foraDaCurva === null ? 0 : Number(l.foraDaCurva),
    }));
}

/**
 * Modelo do nicho mais recente (etapa 9, decisao 2 do `PROXIMO.md`): so o
 * mais novo e usado por quem le. `null` quando o job semanal ainda nao
 * rodou nenhuma vez para o nicho.
 */
export async function modeloNichoAtual(nichoId: number): Promise<ModeloNichoLinha | null> {
  const [linha] = await db()
    .select()
    .from(modelosNicho)
    .where(eq(modelosNicho.nichoId, nichoId))
    .orderBy(desc(modelosNicho.semana), desc(modelosNicho.criadoEm))
    .limit(1);

  return linha ?? null;
}

/**
 * `ModeloNicho` em texto corrido para o bloco estável de um prompt
 * (`temasDoDia`, `avaliarTema`; cache de prompt). `null` quando o job
 * semanal ainda não rodou para o nicho.
 */
export function formatarModeloNicho(modelo: ModeloNicho | null): string {
  if (!modelo) return "Nenhum modelo do nicho ainda: poucos vídeos analisados até agora.";

  const linhas = [modelo.resumo];
  if (modelo.assuntosQuentes.length > 0) {
    linhas.push(`Assuntos quentes: ${modelo.assuntosQuentes.join(", ")}`);
  }
  if (modelo.ganchos.length > 0) {
    linhas.push(
      `Ganchos que funcionam: ${modelo.ganchos.map((g) => `${g.tipo} (${g.frequencia}): ${g.exemplo}`).join("; ")}`,
    );
  }
  if (modelo.formatos.length > 0) {
    linhas.push(`Formatos: ${modelo.formatos.map((f) => `${f.formato} (${f.participacao})`).join(", ")}`);
  }
  linhas.push(`Baseado em ${modelo.baseadoEm} vídeo(s), ${modelo.acimaDoLimiar} fora da curva de verdade.`);
  return linhas.join("\n");
}
