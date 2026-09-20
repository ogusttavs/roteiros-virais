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
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  contas,
  modelosNicho,
  videos,
  type AnaliseVideo,
  type AnaliseVisual,
  type MedianaOrigem,
  type ModeloNicho,
  type Plataforma,
  type TipoAbertura,
} from "@/db/schema";
import { config } from "@/lib/config";
import { LIMIAR_FORA_DA_CURVA } from "@/lib/formatarNumero";
import { aplicarProporcaoBrasil, classificarBrasil, contaEhBrasileira } from "@/servicos/proporcao-brasil";

export type ModeloNichoLinha = typeof modelosNicho.$inferSelect;

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

/**
 * V2b, item 6: a proporção 70/30 corta depois da consulta, então a consulta
 * SQL busca um pool maior que o `limite` final (mesmo raciocínio do
 * `FATOR_FILA` de `transcrever.ts`), para sobrar candidato brasileiro
 * suficiente para preencher a cota sem cortar a lista abaixo do necessário
 * só porque os primeiros N por prioridade pura eram majoritariamente
 * internacionais.
 */
const FATOR_POOL_BRASIL = 4;

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

/**
 * V2b, item 10 (achado da prova em produção, 19/09 à noite): sem
 * `maxPorConta`, o `LIMIT` corta pelos maiores valores globais antes de
 * `limitarPorConta` (`selecionar-transcricao.ts`) ter a chance de agir; se
 * as notas altas se concentram em poucas contas, a fila final encolhe
 * muito abaixo do teto diário (medido: 187 vídeos do Instagram fora da
 * curva ficaram de fora, a fila fechou em 32 tentativas para um teto de
 * 40). Com `maxPorConta`, o teto por conta entra dentro da própria
 * consulta, via `row_number() over (partition by conta_id ...)`, antes do
 * `LIMIT`: cada conta nunca ocupa mais que `maxPorConta` vagas do pool,
 * então o pool inteiro fica cheio de contas diferentes, não só das que têm
 * a nota mais alta. Vídeo sem dono (`conta_id` nulo) nunca é cortado por
 * este teto (mesma regra de `limitarPorConta`): entra incondicionalmente
 * no `WHERE` externo.
 */
async function comTetoPorConta(
  colunaOrdenacao: "fora_da_curva" | "velocidade_relativa",
  condicoesSql: ReturnType<typeof sql>,
  limite: number,
  maxPorConta: number,
): Promise<VideoRankeado[]> {
  // Sem alias curto (nao "v"/"c"): as `condicoesSql`, montadas com os
  // fragmentos do Drizzle (`eq(videos.nichoId, ...)` etc.), sempre geram
  // `"videos"."coluna"` (o nome completo da tabela); um alias diferente
  // quebraria essa referencia ("invalid reference to FROM-clause entry",
  // achado rodando o teste de integracao desta rodada).
  const resultado = await db().execute<{
    id: number;
    plataforma: Plataforma;
    url: string;
    titulo: string | null;
    conta_handle: string | null;
    views: number;
    fora_da_curva: string | null;
    velocidade: string | null;
    velocidade_relativa: string | null;
    publicado_em: Date | null;
  }>(sql`
    WITH candidatos AS (
      SELECT
        videos.id, videos.plataforma, videos.url, videos.titulo, contas.handle AS conta_handle, videos.views,
        videos.fora_da_curva, videos.velocidade, videos.velocidade_relativa, videos.publicado_em,
        videos.conta_id,
        row_number() OVER (
          PARTITION BY videos.conta_id
          ORDER BY videos.${sql.raw(colunaOrdenacao)} DESC NULLS LAST, videos.id ASC
        ) AS posicao_na_conta
      FROM videos
      LEFT JOIN contas ON contas.id = videos.conta_id
      WHERE ${condicoesSql}
    )
    SELECT id, plataforma, url, titulo, conta_handle, views, fora_da_curva, velocidade, velocidade_relativa, publicado_em
    FROM candidatos
    WHERE conta_id IS NULL OR posicao_na_conta <= ${maxPorConta}
    ORDER BY ${sql.raw(colunaOrdenacao)} DESC NULLS LAST, id ASC
    LIMIT ${limite}
  `);

  return resultado.rows.map((l) =>
    mapear({
      id: l.id,
      plataforma: l.plataforma,
      url: l.url,
      titulo: l.titulo,
      contaHandle: l.conta_handle,
      views: l.views,
      foraDaCurva: l.fora_da_curva,
      velocidade: l.velocidade,
      velocidadeRelativa: l.velocidade_relativa,
      publicadoEm: l.publicado_em,
    }),
  );
}

/**
 * O que está fora da curva no nicho nos últimos `dias` dias (escopo 5.1).
 * `maxPorConta` (V2b, item 10, opcional): aplica o teto por conta dentro
 * da própria consulta, antes do `limite`; sem ele, comportamento igual a
 * antes (usado por quem não corta por conta depois, como `/admin`).
 */
export async function foraDaCurvaDoNicho(
  nichoId: number,
  dias = 90,
  limite?: number,
  maxPorConta?: number,
): Promise<VideoRankeado[]> {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, diasAtras(dias)),
    isNotNull(videos.foraDaCurva),
    PERTENCE_AO_NICHO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  if (maxPorConta !== undefined && limite !== undefined) {
    return comTetoPorConta("fora_da_curva", and(...condicoes)!, limite, maxPorConta);
  }

  const consulta = db()
    .select(COLUNAS)
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(...condicoes))
    .orderBy(desc(videos.foraDaCurva), asc(videos.id));

  const linhas = limite ? await consulta.limit(limite) : await consulta;
  return linhas.map(mapear);
}

/**
 * O que está subindo hoje no nicho: 2 a 7 dias, por velocidade relativa
 * (escopo 5.1). `maxPorConta` (V2b, item 10, opcional): mesmo raciocínio
 * de `foraDaCurvaDoNicho`.
 */
export async function subindoHoje(nichoId: number, limite?: number, maxPorConta?: number): Promise<VideoRankeado[]> {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    lte(videos.publicadoEm, diasAtras(2)),
    gte(videos.publicadoEm, diasAtras(7)),
    isNotNull(videos.velocidadeRelativa),
    PERTENCE_AO_NICHO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  if (maxPorConta !== undefined && limite !== undefined) {
    return comTetoPorConta("velocidade_relativa", and(...condicoes)!, limite, maxPorConta);
  }

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

export type VideoSemDonoComAssunto = { id: number; assunto: string };

const LIMITE_SEM_DONO = 10;

/**
 * Vídeos sem conta dona (Hashtag Search da Meta, `videos.semDono`) com
 * análise, dos últimos 7 dias, no máximo `LIMITE_SEM_DONO` por nicho
 * (achado da leitura prévia do Fable, 09/09/2026, correção 3 do
 * `PROXIMO.md`): sem conta, o vídeo não tem velocidade nem múltiplo, então
 * nunca aparecia em `subindoHojeComAnalise`, e a Hashtag Search virava custo
 * de transcrição sem efeito nenhum no tema do dia. Peso "na média" (sem
 * multiplicador), citado pelo job como "assunto em alta na hashtag" em vez
 * de um número, porque não há base de comparação.
 */
export async function semDonoComAnalise(nichoId: number): Promise<VideoSemDonoComAssunto[]> {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    eq(videos.semDono, true),
    gte(videos.publicadoEm, diasAtras(7)),
    isNotNull(videos.analise),
    PERTENCE_AO_NICHO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const linhas = await db()
    .select({ id: videos.id, analise: videos.analise })
    .from(videos)
    .where(and(...condicoes))
    .orderBy(desc(videos.publicadoEm), asc(videos.id))
    .limit(LIMITE_SEM_DONO);

  return linhas
    .filter((l): l is typeof l & { analise: AnaliseVideo } => l.analise !== null)
    .map((l) => ({ id: l.id, assunto: l.analise.assunto }));
}

/** Palavras com 4 ou mais letras do texto do tema, sem repetir (etapa 10). */
export function palavrasChave(texto: string): string[] {
  const encontradas = texto.toLowerCase().match(/\p{L}{4,}/gu) ?? [];
  return [...new Set(encontradas)];
}

/**
 * As condições de casamento de um texto de tema contra o banco (etapa 10,
 * decisão 5; casamento por etiqueta trocado na etapa 11, ajuste 2 da
 * revisão da etapa 10), compartilhadas por `evidenciaParaTema` e
 * `evidenciaParaRoteiro`: busca textual (`videos.busca`, gerada com título,
 * descrição, transcrição e assunto) ou etiqueta que **contenha** alguma
 * palavra do texto (subcadeia, sem caixa), nos últimos 90 dias. Etiqueta
 * real costuma ser frase composta ("clareamento dental"), então igualdade
 * exata (a versão antiga, com o operador `?|`) quase nunca casava;
 * confirmado numa rodada real. Sem `unaccent` (extensão que exigiria
 * migração própria, sobrevivendo a `resetarSchema`; decisão registrada em
 * `TODO.md`), só `lower()`: "não" buscado não casa "nao" numa etiqueta, e
 * vice versa.
 */
function condicoesEvidencia(nichoId: number, texto: string) {
  const palavras = palavrasChave(texto);
  const padroes = palavras.map((p) => `%${p}%`);
  // "text[]" pede um array de verdade; um array JS interpolado direto vira
  // uma lista de parametros separados por virgula, que o Postgres le como um
  // record (erro "cannot cast type record to text[]"), nao como array.
  const padroesSql =
    padroes.length > 0
      ? sql`array[${sql.join(
          padroes.map((p) => sql`${p}`),
          sql`, `,
        )}]::text[]`
      : sql`array[]::text[]`;
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, diasAtras(90)),
    isNotNull(videos.analise),
    PERTENCE_AO_NICHO,
    sql`(${videos.busca} @@ plainto_tsquery('portuguese', ${texto}) or exists (
      select 1 from jsonb_array_elements_text(${videos.etiquetas}) as etiqueta(valor)
      where lower(etiqueta.valor) like any (${padroesSql})
    ))`,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));
  return condicoes;
}

export type VideoEvidenciaTema = { id: number; assunto: string; gancho: string; foraDaCurva: number };

/**
 * Evidência de um tema proposto pelo cliente (etapa 10, decisão 5 do
 * `PROXIMO.md`). Sem palavra nem casamento textual, a lista vem vazia (o
 * prompt já sabe dizer "sem evidência" para isso).
 *
 * V2b, item 6: busca um pool de `limite * FATOR_POOL_BRASIL` antes da
 * proporção 70/30 cortar para o `limite` de verdade (mesmo raciocínio do
 * `transcrever`, sem isso o corte de tamanho do SQL já teria truncado a
 * lista antes de a proporção ter candidato brasileiro suficiente para
 * escolher).
 */
export async function evidenciaParaTema(
  nichoId: number,
  texto: string,
  limite = 8,
  proporcaoBrasil = config.regras.proporcaoBrasil,
): Promise<VideoEvidenciaTema[]> {
  const linhas = await db()
    .select({
      id: videos.id,
      analise: videos.analise,
      foraDaCurva: videos.foraDaCurva,
      idioma: videos.idioma,
      contaPais: contas.pais,
      contaIdiomaPrincipal: contas.idiomaPrincipal,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(...condicoesEvidencia(nichoId, texto)))
    .orderBy(desc(videos.foraDaCurva), asc(videos.id))
    .limit(limite * FATOR_POOL_BRASIL);

  const comAnalise = linhas.filter((l): l is typeof l & { analise: AnaliseVideo } => l.analise !== null);
  const comProporcao = aplicarProporcaoBrasil(
    comAnalise,
    limite,
    (l) => classificarBrasil(l.idioma, contaEhBrasileira(l.contaPais, l.contaIdiomaPrincipal)),
    proporcaoBrasil,
  );

  return comProporcao.map((l) => ({
    id: l.id,
    assunto: l.analise.assunto,
    gancho: l.analise.gancho,
    foraDaCurva: l.foraDaCurva === null ? 0 : Number(l.foraDaCurva),
  }));
}

export type VideoEvidenciaRoteiro = {
  id: number;
  assunto: string;
  gancho: string;
  estrutura: string;
  fechamento: string;
  chamadaFinal: string;
  foraDaCurva: number;
  analiseVisual: AnaliseVisual | null;
  /** V2b, item 6: para `combinarEvidencias` (roteiro.ts) aplicar a proporção 70/30. */
  idioma: string | null;
  contaBrasileira: boolean;
  /** V4, item 3: para `escolherTipoAbertura` (roteiro.ts) decidir a abertura sem repetir os últimos 5 do cliente. */
  tipoAbertura: TipoAbertura | null;
  /** V4, item 6: para `forcaDaEvidencia` (roteiro.ts) contar contas distintas e a idade do vídeo mais novo. */
  contaId: number | null;
  publicadoEm: Date | null;
};

/**
 * Evidência para o roteiro (etapa 11, decisão 1 do `PROXIMO.md`): mesmo
 * casamento de `evidenciaParaTema`, mas com a ficha inteira da extração
 * (estrutura, fechamento, chamada final) e a análise visual quando houver,
 * para o roteiro poder imitar o que já funcionou, não só citar o assunto.
 */
function mapearEvidenciaRoteiro(
  linhas: {
    id: number;
    analise: AnaliseVideo | null;
    analiseVisual: AnaliseVisual | null;
    foraDaCurva: string | null;
    idioma: string | null;
    contaPais: string | null;
    contaIdiomaPrincipal: string | null;
    tipoAbertura: TipoAbertura | null;
    contaId: number | null;
    publicadoEm: Date | null;
  }[],
): VideoEvidenciaRoteiro[] {
  return linhas
    .filter((l): l is typeof l & { analise: AnaliseVideo } => l.analise !== null)
    .map((l) => ({
      id: l.id,
      assunto: l.analise.assunto,
      gancho: l.analise.gancho,
      estrutura: l.analise.estrutura,
      fechamento: l.analise.fechamento,
      chamadaFinal: l.analise.chamadaFinal,
      foraDaCurva: l.foraDaCurva === null ? 0 : Number(l.foraDaCurva),
      analiseVisual: l.analiseVisual,
      idioma: l.idioma,
      contaBrasileira: contaEhBrasileira(l.contaPais, l.contaIdiomaPrincipal),
      tipoAbertura: l.tipoAbertura,
      contaId: l.contaId,
      publicadoEm: l.publicadoEm,
    }));
}

/**
 * V2b, item 6: devolve um pool de `limite * FATOR_POOL_BRASIL`, sem cortar
 * pela proporção aqui dentro; quem corta para o `limite` de verdade é
 * `combinarEvidencias` (roteiro.ts), que combina isto com `evidenciaPorIds`
 * antes de aplicar a proporção 70/30 no conjunto final.
 */
export async function evidenciaParaRoteiro(
  nichoId: number,
  texto: string,
  limite = 8,
): Promise<VideoEvidenciaRoteiro[]> {
  const linhas = await db()
    .select({
      id: videos.id,
      analise: videos.analise,
      analiseVisual: videos.analiseVisual,
      foraDaCurva: videos.foraDaCurva,
      idioma: videos.idioma,
      contaPais: contas.pais,
      contaIdiomaPrincipal: contas.idiomaPrincipal,
      tipoAbertura: videos.tipoAbertura,
      contaId: videos.contaId,
      publicadoEm: videos.publicadoEm,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(...condicoesEvidencia(nichoId, texto)))
    .orderBy(desc(videos.foraDaCurva), asc(videos.id))
    .limit(limite * FATOR_POOL_BRASIL);

  return mapearEvidenciaRoteiro(linhas);
}

/**
 * A ficha rica de evidência (mesmos campos de `evidenciaParaRoteiro`) para
 * ids já conhecidos (etapa 11): usada para os ids que `temasDoDia` já
 * validou como evidência de um tema sugerido, que podem não bater na busca
 * textual do próprio título do tema (a busca da evidência do dia usa
 * `subindoHojeComAnalise`, um caminho diferente).
 */
export async function evidenciaPorIds(ids: number[]): Promise<VideoEvidenciaRoteiro[]> {
  if (ids.length === 0) return [];
  const linhas = await db()
    .select({
      id: videos.id,
      analise: videos.analise,
      analiseVisual: videos.analiseVisual,
      foraDaCurva: videos.foraDaCurva,
      idioma: videos.idioma,
      contaPais: contas.pais,
      contaIdiomaPrincipal: contas.idiomaPrincipal,
      tipoAbertura: videos.tipoAbertura,
      contaId: videos.contaId,
      publicadoEm: videos.publicadoEm,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(inArray(videos.id, ids));

  return mapearEvidenciaRoteiro(linhas);
}

export type EvidenciaResumo = {
  contaNome: string | null;
  contaHandle: string | null;
  /** De onde veio a mediana da conta, para `rotuloMultiploConta` trocar o texto quando é "setor". */
  contaMedianaOrigem: MedianaOrigem | null;
  multiplicador: number;
  views: number;
  publicadoEm: Date | null;
  /** Quantos outros vídeos da lista, além do citado acima (design v2, Hoje.Normal e Hoje.Gerado). */
  quantidadeParecidos: number;
};

/**
 * O bloco de evidência de um tema ou do roteiro do dia em `/hoje` (design
 * v2, `PROXIMO.md`, D2 parte 1, item 5): conta, quantas vezes acima do
 * normal e views do vídeo mais fora da curva da lista, mais quantos outros
 * vídeos parecidos sustentam o mesmo tema. `null` sem nenhum vídeo (a tela
 * não mostra o bloco, nunca um número inventado, `BRIEF.md` seção 4).
 */
export async function evidenciaResumoPorIds(ids: number[]): Promise<EvidenciaResumo | null> {
  if (ids.length === 0) return null;

  const linhas = await db()
    .select({
      contaNome: contas.nome,
      contaHandle: contas.handle,
      contaMedianaOrigem: contas.medianaOrigem,
      foraDaCurva: videos.foraDaCurva,
      views: videos.views,
      publicadoEm: videos.publicadoEm,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(inArray(videos.id, ids))
    .orderBy(desc(videos.foraDaCurva), asc(videos.id));

  if (linhas.length === 0) return null;

  const [principal] = linhas;
  return {
    contaNome: principal.contaNome,
    contaHandle: principal.contaHandle,
    contaMedianaOrigem: principal.contaMedianaOrigem,
    multiplicador: principal.foraDaCurva === null ? 0 : Number(principal.foraDaCurva),
    views: principal.views,
    publicadoEm: principal.publicadoEm,
    quantidadeParecidos: linhas.length - 1,
  };
}

export type VideoReferencia = {
  id: number;
  plataforma: Plataforma;
  url: string;
  contaHandle: string | null;
  /**
   * O YouTube grava o id do canal em `contas.handle` (nunca um @handle
   * legível); mostrar isso ao cliente era o bug relatado no iPad
   * (06/09/2026). O cartão prefere `contaNome`, que a coleta preenche com
   * `channelTitle`/`nickName`/`ownerFullName`.
   */
  contaNome: string | null;
  /** De onde veio a mediana da conta, para `rotuloMultiploConta` trocar o texto quando é "setor". */
  contaMedianaOrigem: MedianaOrigem | null;
  publicadoEm: Date | null;
  foraDaCurva: number;
  assunto: string;
  gancho: string;
  estrutura: string;
  porQueFuncionou: string;
  formato: AnaliseVideo["formato"];
};

/**
 * A régua de "fora da curva" mora em `formatarNumero.ts` (`classificarMultiplo`),
 * como número; aqui vira string porque a coluna é `numeric` no Postgres e o
 * Drizzle representa esse tipo como string (leitura prévia do Fable,
 * acabamento do iPad, item 4: as duas réguas escritas em separado podiam
 * divergir sem ninguém notar).
 */
const LIMIAR_FORA_DA_CURVA_CONSULTA = String(LIMIAR_FORA_DA_CURVA);

/**
 * A biblioteca de referências (etapa 12, decisão 1 do `PROXIMO.md`, brief
 * 6.6): fora da curva do nicho, mais recentes primeiro (não por
 * `foraDaCurva`, diferença de `foraDaCurvaDoNicho`), com a ficha de análise
 * inteira para as três linhas do cartão e o filtro de formato. Só vídeo já
 * analisado entra (sem `analise` não tem o que mostrar).
 *
 * Filtra por `foraDaCurva >= 1,5` (achado do primeiro uso no iPad, item 4):
 * a consulta antiga só exigia `foraDaCurva` não nulo, e um vídeo na média
 * da conta (0,7x, 1,0x) aparecia como se fosse referência.
 *
 * V2b, item 6: a proporção 70/30 corta por página (o `limite` de cada
 * chamada), então o pool buscado no SQL também cresce por
 * `FATOR_POOL_BRASIL`, mesmo raciocínio de `evidenciaParaTema`.
 */
export async function referenciasDoNicho(
  nichoId: number,
  dias = 90,
  limite = 60,
  proporcaoBrasil = config.regras.proporcaoBrasil,
): Promise<VideoReferencia[]> {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, diasAtras(dias)),
    gte(videos.foraDaCurva, LIMIAR_FORA_DA_CURVA_CONSULTA),
    isNotNull(videos.analise),
    PERTENCE_AO_NICHO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const linhas = await db()
    .select({
      id: videos.id,
      plataforma: videos.plataforma,
      url: videos.url,
      contaHandle: contas.handle,
      contaNome: contas.nome,
      contaMedianaOrigem: contas.medianaOrigem,
      publicadoEm: videos.publicadoEm,
      foraDaCurva: videos.foraDaCurva,
      analise: videos.analise,
      idioma: videos.idioma,
      contaPais: contas.pais,
      contaIdiomaPrincipal: contas.idiomaPrincipal,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(...condicoes))
    .orderBy(desc(videos.publicadoEm), asc(videos.id))
    .limit(limite * FATOR_POOL_BRASIL);

  const comAnalise = linhas.filter((l): l is typeof l & { analise: AnaliseVideo } => l.analise !== null);
  const comProporcao = aplicarProporcaoBrasil(
    comAnalise,
    limite,
    (l) => classificarBrasil(l.idioma, contaEhBrasileira(l.contaPais, l.contaIdiomaPrincipal)),
    proporcaoBrasil,
  );

  return comProporcao.map((l) => ({
    id: l.id,
    plataforma: l.plataforma,
    url: l.url,
    contaHandle: l.contaHandle,
    contaNome: l.contaNome,
    contaMedianaOrigem: l.contaMedianaOrigem,
    publicadoEm: l.publicadoEm,
    foraDaCurva: l.foraDaCurva === null ? 0 : Number(l.foraDaCurva),
    assunto: l.analise.assunto,
    gancho: l.analise.gancho,
    estrutura: l.analise.estrutura,
    porQueFuncionou: l.analise.porQueFuncionou,
    formato: l.analise.formato,
  }));
}

export type VideoParaEmbed = {
  id: number;
  plataforma: Plataforma;
  url: string;
  contaNome: string | null;
  contaHandle: string | null;
  /** De onde veio a mediana da conta, para `rotuloMultiploConta` trocar o texto quando é "setor". */
  contaMedianaOrigem: MedianaOrigem | null;
  foraDaCurva: number;
  porQueFuncionou: string | null;
};

/**
 * Plataforma, url e a ficha da conta, para montar o embed e o cartão "de
 * onde veio" da referência (etapa 11, `RoteiroTela`; design v2, `PROXIMO.md`,
 * D2 parte 1, item 6: cartão "de onde veio" com conta e múltiplo reais).
 */
export async function videoPorId(id: number): Promise<VideoParaEmbed | null> {
  const [linha] = await db()
    .select({
      id: videos.id,
      plataforma: videos.plataforma,
      url: videos.url,
      contaNome: contas.nome,
      contaHandle: contas.handle,
      contaMedianaOrigem: contas.medianaOrigem,
      foraDaCurva: videos.foraDaCurva,
      analise: videos.analise,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(eq(videos.id, id));

  if (!linha) return null;
  return {
    id: linha.id,
    plataforma: linha.plataforma,
    url: linha.url,
    contaNome: linha.contaNome,
    contaHandle: linha.contaHandle,
    contaMedianaOrigem: linha.contaMedianaOrigem,
    foraDaCurva: linha.foraDaCurva === null ? 0 : Number(linha.foraDaCurva),
    porQueFuncionou: linha.analise?.porQueFuncionou ?? null,
  };
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
  /**
   * Etapa 11: `duracaoTipicaS`, `estruturas`, `fechamentos` e
   * `chamadasFinais` existem desde a etapa 9 (`modeloNicho`, decisão 2 do
   * `PROXIMO.md`) mas não entravam aqui; o roteiro (decisão 1 da etapa 11)
   * é a primeira tarefa que precisa deles de verdade, para imitar exemplo
   * literal em vez de regra abstrata (escopo 5.9.5).
   */
  linhas.push(`Duração típica: de ${modelo.duracaoTipicaS.min} a ${modelo.duracaoTipicaS.max} segundos.`);
  if (modelo.estruturas.length > 0) {
    linhas.push(`Estruturas que funcionam: ${modelo.estruturas.join("; ")}`);
  }
  if (modelo.fechamentos.length > 0) {
    linhas.push(`Fechamentos que funcionam: ${modelo.fechamentos.join("; ")}`);
  }
  if (modelo.chamadasFinais.length > 0) {
    linhas.push(`Chamadas finais que funcionam: ${modelo.chamadasFinais.join("; ")}`);
  }
  if (modelo.formatos.length > 0) {
    linhas.push(`Formatos: ${modelo.formatos.map((f) => `${f.formato} (${f.participacao})`).join(", ")}`);
  }
  linhas.push(
    `Edição: texto na tela ${modelo.edicao.textoNaTela}; ritmo de corte ${modelo.edicao.ritmoDeCorte}` +
      (modelo.edicao.recursos.length > 0 ? `; recursos ${modelo.edicao.recursos.join(", ")}` : "") +
      (modelo.edicao.audio ? `; áudio da semana ${modelo.edicao.audio}` : ""),
  );
  linhas.push(`Baseado em ${modelo.baseadoEm} vídeo(s), ${modelo.acimaDoLimiar} fora da curva de verdade.`);
  return linhas.join("\n");
}
