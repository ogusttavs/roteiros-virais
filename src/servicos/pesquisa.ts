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
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, type SQL, sql } from "drizzle-orm";

import { FORMATOS_SEM_FALA } from "@/config/formatos";
import { TAMANHO_PAGINA_TODOS_PADRAO } from "@/config/referencias";
import { db } from "@/db";
import {
  contas,
  modelosNicho,
  nichos,
  videos,
  type AnaliseVideo,
  type AnaliseVisual,
  type MedianaOrigem,
  type ModeloNicho,
  type Plataforma,
  type TipoAbertura,
  type TipoConteudo,
} from "@/db/schema";
import { config } from "@/lib/config";
import { LIMIAR_FORA_DA_CURVA } from "@/lib/formatarNumero";
import { PALAVRAS_VAZIAS } from "@/lib/palavras-vazias";
import type { FiltroDeFormatosDaMarca } from "@/servicos/formatos";
import { aplicarProporcaoBrasil, classificarBrasil, contaEhBrasileira } from "@/servicos/proporcao-brasil";
import { aplicarTetoPorConta } from "@/servicos/teto-por-conta";

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

/** M3: os três ajustes por setor, sempre resolvidos (nunca `null`: `reguaDoSetor` já aplica o padrão). */
export type ReguaSetor = {
  pisoViews: number;
  proporcaoBrasil: number;
  videoSemFalaVale: boolean;
};

/**
 * M3, a régua por setor: piso de views, proporção mínima de vídeo brasileiro e "vídeo sem fala
 * vale" eram globais (`config.regras`); agora cada setor pode ajustar os três no admin, sem
 * mexer em `.env` nem em código (colunas de `nichos`, anuláveis; nulo usa o padrão de
 * `config.regras`, "voltar ao padrão" só grava nulo de novo). Única função que lê essas três
 * colunas: toda consulta de `pesquisa.ts` e os jobs `pontuar`, `transcrever`, `extrair-agora` e a
 * análise visual passam por aqui, nunca direto em `config.regras`. O teto de duração (180 s) fica
 * de fora de propósito: vídeo curto é regra do produto, não do setor.
 */
export async function reguaDoSetor(nichoId: number): Promise<ReguaSetor> {
  const [linha] = await db()
    .select({
      pisoViews: nichos.pisoViews,
      proporcaoBrasil: nichos.proporcaoBrasil,
      videoSemFalaVale: nichos.videoSemFalaVale,
    })
    .from(nichos)
    .where(eq(nichos.id, nichoId));

  return {
    pisoViews: linha?.pisoViews ?? config.regras.pisoViewsReferencia,
    proporcaoBrasil: linha?.proporcaoBrasil == null ? config.regras.proporcaoBrasil : Number(linha.proporcaoBrasil),
    videoSemFalaVale: linha?.videoSemFalaVale ?? false,
  };
}

/** E45 PR 3: um setor da conta (o principal ou um alternativo) com o piso de views dele (a régua é por setor, M3). */
export type SetorDaBusca = { id: number; pisoViews: number };

/** O piso de cada setor, na ordem recebida (o principal primeiro). Um setor sem linha cai no padrão, como `reguaDoSetor`. */
export async function setoresComPiso(ids: number[]): Promise<SetorDaBusca[]> {
  return Promise.all(ids.map(async (id) => ({ id, pisoViews: (await reguaDoSetor(id)).pisoViews })));
}

/**
 * "Do setor X, com o piso de X" para um ou mais setores: cada ramo da conta tem a própria régua, então um vídeo do alternativo é medido pelo
 * piso do alternativo, não pelo do principal. Com um setor só, é o par de condições de sempre (nada muda para quem não tem alternativo).
 */
function condicaoDeSetores(setores: SetorDaBusca[]): SQL[] {
  if (setores.length === 1) return [eq(videos.nichoId, setores[0].id), gte(videos.views, setores[0].pisoViews)];
  const algum = or(...setores.map((s) => and(eq(videos.nichoId, s.id), gte(videos.views, s.pisoViews))));
  return algum ? [algum] : [sql`false`];
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

/**
 * O teto de duração (hotfix de 30/09/2026, achado do Gustavo na Overtake Pro: das três
 * Referências, duas eram vídeos longos, um de dez minutos). O produto é vídeo curto; um vídeo
 * longo não é referência, tema nem evidência, por mais views que tenha, e também não gasta
 * vaga de transcrição (`transcrever.ts` escolhe por `foraDaCurvaDoNicho`). Vídeo sem duração
 * guardada passa: hoje é o caso de boa parte do Instagram pela API da Meta, que é Reels.
 * `TETO_DURACAO_REFERENCIA_S` ajusta sem mexer em código (`config.regras`).
 */
export const DENTRO_DO_TETO_DE_DURACAO = sql`(${videos.duracaoS} is null or ${videos.duracaoS} <= ${config.regras.tetoDuracaoReferenciaS})`;

/**
 * Achado 1 da revisão do motor (01/10/2026): o teto por conta (`comTetoPorConta`, abaixo) escolhia
 * os 2 melhores vídeos de cada conta por nota, sem saber se já tinham sido lidos; uma conta com os
 * 2 melhores já transcritos nunca oferecia o 3º ao `transcrever`, mesmo livre, e o teto diário
 * ficava ocioso (348 vídeos acima do piso sem análise na Overtake). Exclui aqui, antes do
 * `row_number` por conta, o que `transcrever.ts` (`soElegivelParaTranscricao`) já não aproveitaria.
 * Função, não constante: `new Date()` precisa ser "agora" a cada chamada, não "agora" de quando o
 * processo (de vida longa, o worker) carregou o módulo.
 */
function elegivelParaTranscricao(): SQL<unknown> {
  return sql`${isNull(videos.transcricao)} and ${isNull(videos.analise)} and (${isNull(
    videos.proximaTentativaTranscricao,
  )} or ${lte(videos.proximaTentativaTranscricao, new Date())})`;
}

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
 * `soElegivelParaTranscricao` (achado 1 da revisão do motor): só o
 * `transcrever.ts` passa, para o teto por conta não gastar as duas vagas da
 * conta com vídeo que ele já não aproveitaria.
 */
export async function foraDaCurvaDoNicho(
  nichoId: number,
  dias = 90,
  limite?: number,
  maxPorConta?: number,
  soElegivelParaTranscricao = false,
): Promise<VideoRankeado[]> {
  const regua = await reguaDoSetor(nichoId);
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, diasAtras(dias)),
    // V9d, item 0b: o piso vem antes do múltiplo, também na seleção de leitura (transcrição e
    // análise usam esta função via `transcrever.ts`): ler primeiro o que passa do piso.
    // M3: o piso é do setor (`reguaDoSetor`), não mais global.
    gte(videos.views, regua.pisoViews),
    isNotNull(videos.foraDaCurva),
    PERTENCE_AO_NICHO,
    DENTRO_DO_TETO_DE_DURACAO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));
  if (soElegivelParaTranscricao) condicoes.push(elegivelParaTranscricao());

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
 * de `foraDaCurvaDoNicho`. `soElegivelParaTranscricao`: idem.
 */
export async function subindoHoje(
  nichoId: number,
  limite?: number,
  maxPorConta?: number,
  soElegivelParaTranscricao = false,
): Promise<VideoRankeado[]> {
  const regua = await reguaDoSetor(nichoId);
  const condicoes = [
    eq(videos.nichoId, nichoId),
    lte(videos.publicadoEm, diasAtras(2)),
    gte(videos.publicadoEm, diasAtras(7)),
    // M3: mesmo piso do setor que "fora da curva" e Referências; sem ele, "subindo hoje" mostrava
    // vídeo com poucas views só porque a velocidade relativa da conta é alta.
    gte(videos.views, regua.pisoViews),
    isNotNull(videos.velocidadeRelativa),
    PERTENCE_AO_NICHO,
    DENTRO_DO_TETO_DE_DURACAO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));
  if (soElegivelParaTranscricao) condicoes.push(elegivelParaTranscricao());

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

export type VideoComAssunto = {
  id: number;
  assunto: string;
  velocidadeRelativa: number;
  /** Hotfix de 02/10/2026: a conta e a origem vão para o prompt do tema, que precisa montar a prova (2 contas, parte brasileira). */
  contaId: number | null;
  brasileiro: boolean;
};

/** Quantas vezes o `limite` o `brasilPrimeiro` olha para achar brasileiro mais abaixo na fila da velocidade. */
const FOLGA_BRASIL_PRIMEIRO = 4;

/**
 * `subindoHoje` com o assunto da análise, para o job `temasDoDia` (etapa 10,
 * decisão 2 do `PROXIMO.md`) citar como evidência. Só vídeo já extraído
 * conta; sem `analise` não tem assunto para o tema descrever.
 */
export async function subindoHojeComAnalise(
  nichoId: number,
  limite = 30,
  opts?: { brasilPrimeiro?: boolean },
): Promise<VideoComAssunto[]> {
  const regua = await reguaDoSetor(nichoId);
  const condicoes = [
    eq(videos.nichoId, nichoId),
    lte(videos.publicadoEm, diasAtras(2)),
    gte(videos.publicadoEm, diasAtras(7)),
    gte(videos.views, regua.pisoViews),
    isNotNull(videos.velocidadeRelativa),
    isNotNull(videos.analise),
    PERTENCE_AO_NICHO,
    DENTRO_DO_TETO_DE_DURACAO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const linhas = await db()
    .select({
      id: videos.id,
      analise: videos.analise,
      velocidadeRelativa: videos.velocidadeRelativa,
      contaId: videos.contaId,
      idioma: videos.idioma,
      contaPais: contas.pais,
      contaIdiomaPrincipal: contas.idiomaPrincipal,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(...condicoes))
    .orderBy(desc(videos.velocidadeRelativa), asc(videos.id))
    .limit(opts?.brasilPrimeiro ? limite * FOLGA_BRASIL_PRIMEIRO : limite);

  const todos = linhas
    .filter((l): l is typeof l & { analise: AnaliseVideo } => l.analise !== null)
    .map((l) => ({
      id: l.id,
      assunto: l.analise.assunto,
      velocidadeRelativa: l.velocidadeRelativa === null ? 0 : Number(l.velocidadeRelativa),
      contaId: l.contaId,
      brasileiro:
        classificarBrasil(l.idioma, contaEhBrasileira(l.contaPais, l.contaIdiomaPrincipal)) === "brasileiro",
    }));
  if (!opts?.brasilPrimeiro) return todos;

  /**
   * Hotfix de 02/10/2026: os 30 mais rápidos de um setor com muita conta de fora quase não traziam
   * brasileiro, e o tema nascia sem ter como montar a prova. Reserva para o Brasil a proporção do
   * setor (nunca menos que metade), completa com o resto na ordem da velocidade, e devolve na
   * ordem da velocidade, como sempre.
   */
  const cotaBrasil = Math.ceil(limite * Math.max(regua.proporcaoBrasil, 0.5));
  const brasileiros = todos.filter((v) => v.brasileiro);
  const deFora = todos.filter((v) => !v.brasileiro);
  const doBrasil = brasileiros.slice(0, cotaBrasil);
  const escolhidos = [...doBrasil, ...deFora.slice(0, limite - doBrasil.length)];
  const faltam = limite - escolhidos.length;
  if (faltam > 0) escolhidos.push(...brasileiros.slice(cotaBrasil, cotaBrasil + faltam));
  return escolhidos.sort((a, b) => b.velocidadeRelativa - a.velocidadeRelativa || a.id - b.id);
}

export type VideoSemDonoComAssunto = { id: number; assunto: string; brasileiro: boolean };

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
    DENTRO_DO_TETO_DE_DURACAO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const linhas = await db()
    .select({ id: videos.id, analise: videos.analise, idioma: videos.idioma })
    .from(videos)
    .where(and(...condicoes))
    .orderBy(desc(videos.publicadoEm), asc(videos.id))
    .limit(LIMITE_SEM_DONO);

  return linhas
    .filter((l): l is typeof l & { analise: AnaliseVideo } => l.analise !== null)
    .map((l) => ({
      id: l.id,
      assunto: l.analise.assunto,
      brasileiro: classificarBrasil(l.idioma, false) === "brasileiro",
    }));
}

/**
 * Palavras com 4 ou mais letras do texto do tema, sem repetir (etapa 10), fora da lista de
 * palavras vazias (M5b, achado 6 da revisão do motor, 01/10/2026: "para", "como" e "mais" casavam
 * qualquer etiqueta que contivesse a subcadeia, por acaso, mesmo sem relação nenhuma com o tema).
 */
export function palavrasChave(texto: string): string[] {
  const encontradas = texto.toLowerCase().match(/\p{L}{4,}/gu) ?? [];
  return [...new Set(encontradas)].filter((palavra) => !PALAVRAS_VAZIAS.has(palavra));
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
 *
 * `exigirServeDeModelo` (H4, item 2): só a evidência do roteiro (nunca a do tema, que continua
 * usando recorte e meme como sinal de assunto) exige `serveDeModelo`. `is not false` em vez de
 * `= true`: nulo (vídeo analisado antes deste campo existir, até a reclassificação em lote
 * rodar) não exclui, só `false` explícito exclui.
 *
 * `relevancia` (M5b, achado 6 da revisão do motor, 01/10/2026): devolvida junto para
 * `evidenciaParaTema`/`evidenciaParaRoteiro` ordenarem por ela antes do múltiplo. Conta quantas
 * palavras-chave (já sem as vazias) batem na busca textual do vídeo, mais quantas etiquetas
 * contêm alguma delas; sem isto, a ordenação era só por múltiplo, e um casamento por acaso
 * (etiqueta que contém a subcadeia de uma palavra comum) entrava com a mesma prioridade de um
 * casamento de verdade, desde que o vídeo tivesse múltiplo alto: "os 8 maiores do setor", não a
 * evidência mais parecida com o tema.
 */
/**
 * E44: o vídeo só entra quando o tipo dele está ligado para a marca (`formatos_da_marca`, `servicos/formatos.ts`). Os dois "sem fala" passam pela régua do setor e pelo
 * roteiro sem fala (M4), não pelas chaves do cliente. Vídeo ainda sem `formato_catalogo` (não reclassificado) passa como antes, pelo corte da H4. Sem o filtro da marca
 * (testes, ferramentas), nada muda: o corte da H4 de sempre.
 *
 * `serve_de_modelo = false` é corte DURO além do tipo (revisão do #118): um recorte ou uma notícia nunca serve de modelo, qualquer que seja a chave. A única exceção é o
 * "humor e meme" que a própria marca ligou: o meme é `serve_de_modelo = false` por definição da H4, e sem a exceção a chave ligada não faria nada. "Todos" nas
 * Referências (`exigirServeDeModelo` falso) não filtra por tipo: mostra todo vídeo com o selo escrito; o filtro por chave vale para a evidência, a prova do tema e os
 * outros segmentos.
 */
function condicaoDeFormato(formatos: FiltroDeFormatosDaMarca | undefined, exigirServeDeModelo: boolean): SQL | null {
  const serve = sql`${videos.serveDeModelo} is not false`;
  if (!exigirServeDeModelo) return null;
  if (!formatos) return serve;
  const permitidos = [...formatos.ligados, ...FORMATOS_SEM_FALA];
  const lista = sql`array[${sql.join(
    permitidos.map((chave) => sql`${chave}`),
    sql`, `,
  )}]::text[]`;
  const doTipo = sql`(${videos.formatoCatalogo} is null or ${videos.formatoCatalogo} = any(${lista}))`;
  // O meme que a marca ligou de propósito vale por cima do corte da H4 (só para quem já respondeu, onde a chave existe de verdade).
  if (formatos.temResposta && formatos.ligados.includes("humor_e_meme")) {
    return sql`((${serve} and ${doTipo}) or ${videos.formatoCatalogo} = 'humor_e_meme')`;
  }
  return sql`(${serve} and ${doTipo})`;
}

function condicoesEvidencia(
  nichoId: number,
  texto: string,
  regua: ReguaSetor,
  exigirServeDeModelo: boolean,
  /** E45 PR 3: os ramos alternativos da conta, com o piso de cada um (vazio: só o principal, como sempre). */
  alternativos: SetorDaBusca[] = [],
  /** E44 PR 1: os formatos ligados da marca; com resposta dela, o corte global de meme e recorte da H4 sai e vale o formato. */
  formatos?: FiltroDeFormatosDaMarca,
): { condicoes: SQL[]; relevancia: SQL<number> } {
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
  const palavrasSql =
    palavras.length > 0
      ? sql`array[${sql.join(
          palavras.map((p) => sql`${p}`),
          sql`, `,
        )}]::text[]`
      : sql`array[]::text[]`;
  const condicoes = [
    // O setor e o piso dele (V9d, item 0b: o piso vem antes do múltiplo, decisão do Gustavo em 25/09/2026; vale para a evidência do tema e
    // do roteiro tanto quanto para a biblioteca de referências; M3: piso do setor). E45 PR 3: com ramos alternativos, cada setor com o seu piso.
    ...condicaoDeSetores([{ id: nichoId, pisoViews: regua.pisoViews }, ...alternativos]),
    gte(videos.publicadoEm, diasAtras(90)),
    isNotNull(videos.analise),
    PERTENCE_AO_NICHO,
    DENTRO_DO_TETO_DE_DURACAO,
    sql`(${videos.busca} @@ plainto_tsquery('portuguese', ${texto}) or exists (
      select 1 from jsonb_array_elements_text(${videos.etiquetas}) as etiqueta(valor)
      where lower(etiqueta.valor) like any (${padroesSql})
    ))`,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));
  const porFormato = condicaoDeFormato(formatos, exigirServeDeModelo);
  if (porFormato) condicoes.push(porFormato);

  const relevancia = sql<number>`(
    (select count(*) from unnest(${palavrasSql}) as palavra where ${videos.busca} @@ plainto_tsquery('portuguese', palavra))
    + (select count(*) from jsonb_array_elements_text(${videos.etiquetas}) as etiqueta(valor) where lower(etiqueta.valor) like any (${padroesSql}))
  )`;

  return { condicoes, relevancia };
}

/** No desempate da relevância, o vídeo do ramo principal vem antes do de um alternativo (só quando a conta tem alternativo). */
function principalPrimeiro(nichoId: number, alternativos: number[]): SQL[] {
  return alternativos.length === 0 ? [] : [sql`case when ${videos.nichoId} = ${nichoId} then 0 else 1 end`];
}

export type VideoEvidenciaTema = { id: number; assunto: string; gancho: string; foraDaCurva: number; /** E45 PR 3: o setor do vídeo (o principal ou um alternativo da conta). */ nichoId: number | null };

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
 *
 * H4, item 2: esta é "a prova do tema" (único uso, `avaliarTema`, a nota dos cinco pilares) e
 * exige `serveDeModelo`, igual à evidência do roteiro; o sinal de assunto que descobre os temas
 * do dia (`subindoHojeComAnalise`, `temas-do-dia.ts`) é outra função, que continua sem filtrar
 * (recorte e meme continuam valendo para saber do que o nicho está falando).
 */
export async function evidenciaParaTema(
  nichoId: number,
  texto: string,
  limite = 8,
  proporcaoBrasilExplicita?: number,
  /** E45 PR 3: os ramos alternativos da conta (ids de setor); a prova olha o principal e eles, o principal primeiro no desempate. */
  alternativos: number[] = [],
  /** E44 PR 1: os formatos ligados da marca. */
  formatos?: FiltroDeFormatosDaMarca,
): Promise<VideoEvidenciaTema[]> {
  const regua = await reguaDoSetor(nichoId);
  const proporcaoBrasil = proporcaoBrasilExplicita ?? regua.proporcaoBrasil;
  const { condicoes, relevancia } = condicoesEvidencia(nichoId, texto, regua, true, await setoresComPiso(alternativos), formatos);
  const linhas = await db()
    .select({
      id: videos.id,
      nichoId: videos.nichoId,
      analise: videos.analise,
      foraDaCurva: videos.foraDaCurva,
      idioma: videos.idioma,
      contaPais: contas.pais,
      contaIdiomaPrincipal: contas.idiomaPrincipal,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(...condicoes))
    .orderBy(desc(relevancia), ...principalPrimeiro(nichoId, alternativos), desc(videos.foraDaCurva), asc(videos.id))
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
    nichoId: l.nichoId,
    assunto: l.analise.assunto,
    gancho: l.analise.gancho,
    foraDaCurva: l.foraDaCurva === null ? 0 : Number(l.foraDaCurva),
  }));
}

export type VideoEvidenciaRoteiro = {
  id: number;
  /** E45 PR 3: o setor do vídeo (o principal ou um alternativo da conta). */
  nichoId: number | null;
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
  /** V12, item 3a: para `combinarEvidencias` (roteiro.ts) preferir a rede principal da marca, sem excluir as outras. */
  plataforma: Plataforma;
  /** M4: para `sugerirEstiloPelaEvidencia` (ia/enums.ts) e para a preferência por evidência sem fala. */
  semFala: boolean | null;
  /** E44 PR 1: o formato do vídeo de referência (`config/formatos.ts`), para o roteiro ser escrito nesse formato, sempre como a versão da marca. Nulo antes da reclassificação. */
  formatoCatalogo: string | null;
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
    nichoId: number | null;
    analise: AnaliseVideo | null;
    analiseVisual: AnaliseVisual | null;
    foraDaCurva: string | null;
    idioma: string | null;
    contaPais: string | null;
    contaIdiomaPrincipal: string | null;
    tipoAbertura: TipoAbertura | null;
    contaId: number | null;
    publicadoEm: Date | null;
    plataforma: Plataforma;
    semFala: boolean | null;
    formatoCatalogo: string | null;
  }[],
): VideoEvidenciaRoteiro[] {
  return linhas
    .filter((l): l is typeof l & { analise: AnaliseVideo } => l.analise !== null)
    .map((l) => ({
      id: l.id,
      nichoId: l.nichoId,
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
      plataforma: l.plataforma,
      semFala: l.semFala,
      formatoCatalogo: l.formatoCatalogo,
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
  /** E45 PR 3: os ramos alternativos da conta (ids de setor); o principal vem primeiro no desempate, e a proporção do Brasil corta o conjunto. */
  alternativos: number[] = [],
  /** E44 PR 1: os formatos ligados da marca. */
  formatos?: FiltroDeFormatosDaMarca,
): Promise<VideoEvidenciaRoteiro[]> {
  const regua = await reguaDoSetor(nichoId);
  const { condicoes, relevancia } = condicoesEvidencia(nichoId, texto, regua, true, await setoresComPiso(alternativos), formatos);
  const linhas = await db()
    .select({
      id: videos.id,
      nichoId: videos.nichoId,
      analise: videos.analise,
      analiseVisual: videos.analiseVisual,
      foraDaCurva: videos.foraDaCurva,
      idioma: videos.idioma,
      contaPais: contas.pais,
      contaIdiomaPrincipal: contas.idiomaPrincipal,
      tipoAbertura: videos.tipoAbertura,
      contaId: videos.contaId,
      publicadoEm: videos.publicadoEm,
      plataforma: videos.plataforma,
      semFala: videos.semFala,
      formatoCatalogo: videos.formatoCatalogo,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(...condicoes))
    .orderBy(desc(relevancia), ...principalPrimeiro(nichoId, alternativos), desc(videos.foraDaCurva), asc(videos.id))
    .limit(limite * FATOR_POOL_BRASIL);

  return mapearEvidenciaRoteiro(linhas);
}

/**
 * A ficha rica de evidência (mesmos campos de `evidenciaParaRoteiro`) para
 * ids já conhecidos (etapa 11): usada para os ids que `temasDoDia` já
 * validou como evidência de um tema sugerido, que podem não bater na busca
 * textual do próprio título do tema (a busca da evidência do dia usa
 * `subindoHojeComAnalise`, um caminho diferente). `temasDoDia` valida pela
 * evidência do tema (`evidenciaParaTema`), que não filtra `serveDeModelo`
 * (recorte e meme contam como sinal de assunto ali); aqui, que é evidência do
 * roteiro, filtra, mesma regra de `evidenciaParaRoteiro` (H4, item 2).
 */
export async function evidenciaPorIds(ids: number[], formatos?: FiltroDeFormatosDaMarca): Promise<VideoEvidenciaRoteiro[]> {
  if (ids.length === 0) return [];
  const linhas = await db()
    .select({
      id: videos.id,
      nichoId: videos.nichoId,
      analise: videos.analise,
      analiseVisual: videos.analiseVisual,
      foraDaCurva: videos.foraDaCurva,
      idioma: videos.idioma,
      contaPais: contas.pais,
      contaIdiomaPrincipal: contas.idiomaPrincipal,
      tipoAbertura: videos.tipoAbertura,
      contaId: videos.contaId,
      publicadoEm: videos.publicadoEm,
      plataforma: videos.plataforma,
      semFala: videos.semFala,
      formatoCatalogo: videos.formatoCatalogo,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(
      and(
        inArray(videos.id, ids),
        condicaoDeFormato(formatos, true) ?? sql`true`,
      ),
    );

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
  /** E44 PR 2: o tipo de vídeo pela lista fechada (`config/formatos.ts`), para o selo do cartão; nulo antes da reclassificação. */
  formatoCatalogo: string | null;
  /** E45 PR 3: o setor do vídeo; a tela mostra o nome do ramo no cartão quando não é o principal. */
  nichoId: number | null;
  plataforma: Plataforma;
  url: string;
  /** Uma linha, com reticências na tela; o normalizador garante título nas três plataformas desde a E6 parte 3. */
  titulo: string | null;
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
  views: number;
  /** `contas.medianaViews`: já reflete a origem certa (conta, seguidores ou setor), é sempre um número só. */
  medianaConta: number | null;
  /** views por hora; `pontuar.ts` só preenche entre 2 e 7 dias depois da publicação. */
  velocidade: number | null;
  assunto: string;
  gancho: string;
  estrutura: string;
  porQueFuncionou: string;
  formato: AnaliseVideo["formato"];
  /** `null` quando a plataforma não trouxe (Hashtag Search da Meta, TikTok ainda suspenso); a tela cai no retângulo neutro. */
  capaUrl: string | null;
  /** M4, item 1: etiqueta "sem fala" no cartão quando `true`; nulo (lido antes desta coluna existir) conta como falado. */
  semFala: boolean | null;
  /** R2a: `analiseVisual.momentoChave.segundo`, para o embed já começar ali; `null` sem análise visual. */
  segundoChave: number | null;
  /**
   * R2b, item 2: o que a extração classificou este vídeo como (H4, item 2); `null` em vídeo
   * analisado antes da coluna existir. "meme"/"recorte" viram o selo no cartão; "original" e
   * "noticia" não mostram selo nenhum.
   */
  tipoConteudo: TipoConteudo | null;
  /**
   * R2b, item 3: `true` quando o vídeo não bate a régua do setor (piso de views ou o múltiplo de
   * 1,5x) que "Fora da curva" exige; só o segmento "Todos" mostra vídeo assim, com o selo
   * tracejado "abaixo do que a gente usa como prova". Nunca muda o que entra em roteiro ou em
   * prova de tema (isso continua em `condicoesReferencias`/`evidenciaParaRoteiro`/`evidenciaParaTema`,
   * intocados).
   */
  abaixoDaRegua: boolean;
};

/**
 * A régua de "fora da curva" mora em `formatarNumero.ts` (`classificarMultiplo`),
 * como número; aqui vira string porque a coluna é `numeric` no Postgres e o
 * Drizzle representa esse tipo como string (leitura prévia do Fable,
 * acabamento do iPad, item 4: as duas réguas escritas em separado podiam
 * divergir sem ninguém notar).
 */
const LIMIAR_FORA_DA_CURVA_CONSULTA = String(LIMIAR_FORA_DA_CURVA);

/** R2b, item 2: as quatro ordens que o banco já sabe calcular; "recentes" é o padrão de sempre. */
export type OrdemReferencias = "recentes" | "views" | "multiplo" | "velocidade";

/** Tipos de conteúdo que entram como filtro (R2b, item 2): meme e recorte, os dois que `serveDeModelo` tira hoje. */
export type TipoConteudoFiltravel = Extract<TipoConteudo, "meme" | "recorte">;

export type FiltrosReferencias = {
  /** E44 PR 1: os formatos ligados da marca; só entra vídeo de formato ligado (os três segmentos), e com resposta dela o corte global de meme e recorte da H4 sai. */
  formatosDaMarca?: FiltroDeFormatosDaMarca;
  /** 7, 30 ou 90; padrão 7, como o design. */
  periodoDias?: number;
  /** Assunto ou conta (V6, item 1): a coluna `busca` (tsvector) mais `contas.nome`. */
  busca?: string;
  plataformas?: Plataforma[];
  formatos?: AnaliseVideo["formato"][];
  /** O segmento "Salvos" (V6, item 2): restringe aos vídeos favoritados, sem estado próprio de consulta. */
  apenasIds?: number[];
  limite?: number;
  proporcaoBrasil?: number;
  /** R2b, item 2: "mais de X views" (o piso da faixa); `undefined` é "qualquer número". */
  viewsMin?: number;
  /** R2b, item 2: `true` só com fala, `false` só sem fala, `undefined` os dois. */
  comFala?: boolean;
  /** R2b, item 2: `true` só Brasil, `false` só de fora, `undefined` os dois. Mesma classificação de `classificarBrasil`/`contaEhBrasileira`, traduzida para SQL em `condicaoBrasil`. */
  brasil?: boolean;
  /** R2b, item 2: a parte de "Tipo de vídeo" que não é `formatos` (o campo `analise.formato`); a lista no filtro mistura os dois, cada um na própria coluna. */
  tiposConteudo?: TipoConteudoFiltravel[];
  /** R2b, item 2: a ordem escolhida; `undefined` é "recentes", o padrão de sempre. */
  ordem?: OrdemReferencias;
  /**
   * E45 PR 3: os setores da conta (o principal primeiro, depois os alternativos), cada um com o piso dele. Sem isto, só o `nichoId` da
   * chamada, como sempre. Com mais de um, a lista olha todos e cada vídeo é medido pelo piso do próprio setor.
   */
  setores?: SetorDaBusca[];
  /** E45 PR 3: a pílula "Ramo": só os vídeos deste setor (um dos `setores`); um id que não é da conta não devolve nada. */
  ramoId?: number;
};

export type ResultadoReferencias = {
  videos: VideoReferencia[];
  /** Quantos vídeos batem nos filtros, sem o corte de `limite` nem a cota 70/30 (é o número do rótulo da tela). */
  total: number;
};

/**
 * Tradução para SQL de `classificarBrasil`/`contaEhBrasileira` (`proporcao-brasil.ts`), para o
 * filtro "Brasil ou fora" (R2b, item 2) valer em SQL, não só em JS: `pt`/`pt-BR` é Brasil; `en`,
 * `es` e `pt-PT` é fora; sem idioma conhecido, decide a conta (`contas.pais = 'BR'` ou
 * `idioma_principal` em português). Mantenha as duas em sincronia: mudou uma, muda a outra.
 */
function condicaoBrasil(brasil: boolean): SQL {
  const ehBrasil = sql`(
    ${videos.idioma} in ('pt', 'pt-BR')
    or (${videos.idioma} is null and (${contas.pais} = 'BR' or ${contas.idiomaPrincipal} in ('pt', 'pt-BR')))
  )`;
  return brasil ? ehBrasil : sql`not ${ehBrasil}`;
}

/** `ORDER BY` de `OrdemReferencias`; sempre com `asc(id)` por último, para a paginação não repetir nem pular linha com empate. */
function ordenacaoReferencias(ordem: OrdemReferencias | undefined) {
  switch (ordem) {
    case "views":
      return [desc(videos.views), asc(videos.id)];
    case "multiplo":
      return [desc(videos.foraDaCurva), asc(videos.id)];
    case "velocidade":
      return [desc(videos.velocidade), asc(videos.id)];
    default:
      return [desc(videos.publicadoEm), asc(videos.id)];
  }
}

/**
 * As condições que a lista e a contagem de `referenciasDoNicho` compartilham (V6, item 1).
 * `serveDeModelo` (H4, item 2): a biblioteca de referências é "o que imitar", igual à evidência
 * do roteiro; recorte e meme não entram, mesma regra de `condicoesEvidencia`.
 *
 * `semRegua` (R2b, item 1): o segmento "Todos" quer "todo vídeo do setor que tem análise, sem o
 * corte do piso nem do múltiplo" (PROXIMO.md); tira também o `serveDeModelo`, porque "Todos"
 * mostra meme e recorte (com o selo escrito, não escondidos). Nunca muda o que
 * `evidenciaParaRoteiro`/`evidenciaParaTema` aceitam: só esta função, só para a tela.
 */
function condicoesReferencias(nichoId: number, filtros: FiltrosReferencias, regua: ReguaSetor, semRegua = false) {
  // E45 PR 3: os setores da conta (um só, sem alternativo) e, se a pílula "Ramo" está escolhida, só aquele.
  const todos: SetorDaBusca[] = filtros.setores && filtros.setores.length > 0 ? filtros.setores : [{ id: nichoId, pisoViews: regua.pisoViews }];
  const alvos = filtros.ramoId === undefined ? todos : todos.filter((s) => s.id === filtros.ramoId);
  const condicoes: SQL[] = [
    alvos.length === 0 ? sql`false` : alvos.length === 1 ? eq(videos.nichoId, alvos[0].id) : inArray(videos.nichoId, alvos.map((s) => s.id)),
    gte(videos.publicadoEm, diasAtras(filtros.periodoDias ?? 7)),
    isNotNull(videos.analise),
    PERTENCE_AO_NICHO,
    DENTRO_DO_TETO_DE_DURACAO,
  ];
  if (!semRegua) {
    // V9d, item 0b: o piso vem antes do múltiplo (decisão do Gustavo em 25/09/2026); um vídeo de
    // poucas views nunca é referência, nem quando o múltiplo bate o limiar sozinho. M3: piso do setor
    // (E45 PR 3: o de cada setor da conta, não o do principal para todos).
    if (alvos.length === 1) condicoes.push(gte(videos.views, alvos[0].pisoViews));
    else if (alvos.length > 1) condicoes.push(...condicaoDeSetores(alvos));
    condicoes.push(gte(videos.foraDaCurva, LIMIAR_FORA_DA_CURVA_CONSULTA));
  }
  // E44 PR 1: os três segmentos (inclusive "Todos") só trazem vídeo de formato ligado para a marca; "Todos" não tem o corte da H4 (mostra meme e recorte com o selo).
  const porFormato = condicaoDeFormato(filtros.formatosDaMarca, !semRegua);
  if (porFormato) condicoes.push(porFormato);
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));
  if (filtros.apenasIds) condicoes.push(inArray(videos.id, filtros.apenasIds.length > 0 ? filtros.apenasIds : [-1]));
  if (filtros.plataformas && filtros.plataformas.length > 0) {
    condicoes.push(inArray(videos.plataforma, filtros.plataformas));
  }
  const temFormatos = filtros.formatos && filtros.formatos.length > 0;
  const temTipos = filtros.tiposConteudo && filtros.tiposConteudo.length > 0;
  if (temFormatos || temTipos) {
    // "Tipo de vídeo" (R2b, item 2) é uma lista só na tela, misturando `analise.formato` e
    // `tipoConteudo`: qualquer valor marcado, de qualquer uma das duas colunas, inclui o vídeo.
    const partes: SQL[] = [];
    if (temFormatos) {
      const formatosSql = sql.join(
        filtros.formatos!.map((f) => sql`${f}`),
        sql`, `,
      );
      partes.push(sql`(${videos.analise} ->> 'formato') = any(array[${formatosSql}]::text[])`);
    }
    if (temTipos) {
      const tiposSql = sql.join(
        filtros.tiposConteudo!.map((t) => sql`${t}`),
        sql`, `,
      );
      partes.push(sql`${videos.tipoConteudo} = any(array[${tiposSql}]::text[])`);
    }
    condicoes.push(partes.length > 1 ? sql`(${sql.join(partes, sql` or `)})` : partes[0]);
  }
  if (filtros.viewsMin !== undefined) condicoes.push(gte(videos.views, filtros.viewsMin));
  if (filtros.comFala !== undefined) {
    condicoes.push(
      filtros.comFala
        ? sql`${videos.semFala} is not true`
        : eq(videos.semFala, true),
    );
  }
  if (filtros.brasil !== undefined) condicoes.push(condicaoBrasil(filtros.brasil));
  const busca = filtros.busca?.trim();
  if (busca) {
    condicoes.push(sql`(${videos.busca} @@ plainto_tsquery('portuguese', ${busca}) or ${contas.nome} ilike ${`%${busca}%`})`);
  }
  return condicoes;
}

/**
 * A biblioteca de referências (etapa 12, decisão 1 do `PROXIMO.md`, brief
 * 6.6; refeita na V6, item 1, D2 parte 3a): fora da curva do nicho, mais
 * recentes primeiro (não por `foraDaCurva`, diferença de
 * `foraDaCurvaDoNicho`), com a ficha de análise inteira para o cartão de
 * métricas e a folha de detalhes, e os filtros da tela (período, busca,
 * plataforma, formato) aplicados aqui, não no cliente. Só vídeo já
 * analisado entra (sem `analise` não tem o que mostrar).
 *
 * Filtra por `foraDaCurva >= 1,5` (achado do primeiro uso no iPad, item 4):
 * a consulta antiga só exigia `foraDaCurva` não nulo, e um vídeo na média
 * da conta (0,7x, 1,0x) aparecia como se fosse referência.
 *
 * V2b, item 6: a proporção 70/30 corta por página (o `limite` de cada
 * chamada), então o pool buscado no SQL também cresce por
 * `FATOR_POOL_BRASIL`, mesmo raciocínio de `evidenciaParaTema`. `total` vem
 * de uma contagem à parte, com as mesmas condições mas sem `limit` nem a
 * cota: é "quantos vídeos existem", não "quantos a página mostra".
 */
const CAMPOS_VIDEO_REFERENCIA = {
  id: videos.id,
  nichoId: videos.nichoId,
  plataforma: videos.plataforma,
  url: videos.url,
  titulo: videos.titulo,
  contaId: videos.contaId,
  contaHandle: contas.handle,
  contaNome: contas.nome,
  contaMedianaOrigem: contas.medianaOrigem,
  publicadoEm: videos.publicadoEm,
  foraDaCurva: videos.foraDaCurva,
  views: videos.views,
  medianaConta: contas.medianaViews,
  velocidade: videos.velocidade,
  analise: videos.analise,
  idioma: videos.idioma,
  contaPais: contas.pais,
  contaIdiomaPrincipal: contas.idiomaPrincipal,
  capaUrl: videos.capaUrl,
  semFala: videos.semFala,
  formatoCatalogo: videos.formatoCatalogo,
  analiseVisual: videos.analiseVisual,
  tipoConteudo: videos.tipoConteudo,
} as const;

type LinhaVideoReferencia = {
  id: number;
  formatoCatalogo: string | null;
  nichoId: number | null;
  plataforma: Plataforma;
  url: string;
  titulo: string | null;
  contaId: number | null;
  contaHandle: string | null;
  contaNome: string | null;
  contaMedianaOrigem: MedianaOrigem | null;
  publicadoEm: Date | null;
  foraDaCurva: string | null;
  views: number;
  medianaConta: string | null;
  velocidade: string | null;
  analise: AnaliseVideo | null;
  idioma: string | null;
  contaPais: string | null;
  contaIdiomaPrincipal: string | null;
  capaUrl: string | null;
  semFala: boolean | null;
  analiseVisual: AnaliseVisual | null;
  tipoConteudo: TipoConteudo | null;
};

/** R2b, item 3: falha a régua do setor quando a tela mostra o selo "abaixo do que a gente usa como prova". */
function abaixoDaRegua(views: number, foraDaCurva: string | null, regua: ReguaSetor): boolean {
  return views < regua.pisoViews || (foraDaCurva === null ? 0 : Number(foraDaCurva)) < LIMIAR_FORA_DA_CURVA;
}

function paraVideoReferencia(l: LinhaVideoReferencia, regua: ReguaSetor, setores?: SetorDaBusca[]): VideoReferencia | null {
  if (l.analise === null) return null;
  // E45 PR 3: o selo "abaixo do que a gente usa" mede pelo piso do setor do próprio vídeo.
  const reguaDoVideo = { ...regua, pisoViews: setores?.find((s) => s.id === l.nichoId)?.pisoViews ?? regua.pisoViews };
  return {
    id: l.id,
    formatoCatalogo: l.formatoCatalogo,
    nichoId: l.nichoId,
    plataforma: l.plataforma,
    url: l.url,
    titulo: l.titulo,
    contaHandle: l.contaHandle,
    contaNome: l.contaNome,
    contaMedianaOrigem: l.contaMedianaOrigem,
    publicadoEm: l.publicadoEm,
    foraDaCurva: l.foraDaCurva === null ? 0 : Number(l.foraDaCurva),
    views: l.views,
    medianaConta: l.medianaConta === null ? null : Number(l.medianaConta),
    velocidade: l.velocidade === null ? null : Number(l.velocidade),
    assunto: l.analise.assunto,
    gancho: l.analise.gancho,
    estrutura: l.analise.estrutura,
    porQueFuncionou: l.analise.porQueFuncionou,
    formato: l.analise.formato,
    capaUrl: l.capaUrl,
    semFala: l.semFala,
    segundoChave: l.analiseVisual?.momentoChave?.segundo ?? null,
    tipoConteudo: l.tipoConteudo,
    abaixoDaRegua: abaixoDaRegua(l.views, l.foraDaCurva, reguaDoVideo),
  };
}

export async function referenciasDoNicho(
  nichoId: number,
  filtros: FiltrosReferencias = {},
): Promise<ResultadoReferencias> {
  const regua = await reguaDoSetor(nichoId);
  const limite = filtros.limite ?? 60;
  const proporcaoBrasil = filtros.proporcaoBrasil ?? regua.proporcaoBrasil;
  const condicoes = condicoesReferencias(nichoId, filtros, regua);

  const [linhas, contagem] = await Promise.all([
    db()
      .select(CAMPOS_VIDEO_REFERENCIA)
      .from(videos)
      .leftJoin(contas, eq(contas.id, videos.contaId))
      .where(and(...condicoes))
      .orderBy(...ordenacaoReferencias(filtros.ordem))
      .limit(limite * FATOR_POOL_BRASIL),
    db()
      .select({ total: sql<number>`count(*)::int` })
      .from(videos)
      .leftJoin(contas, eq(contas.id, videos.contaId))
      .where(and(...condicoes)),
  ]);

  const comAnalise = linhas.filter((l): l is typeof l & { analise: AnaliseVideo } => l.analise !== null);
  const comProporcao = aplicarProporcaoBrasil(
    comAnalise,
    limite,
    (l) => classificarBrasil(l.idioma, contaEhBrasileira(l.contaPais, l.contaIdiomaPrincipal)),
    proporcaoBrasil,
  );
  /**
   * O teto por conta (V6, atualização do `PROXIMO.md`; ajuste do item 0 da
   * V7: vídeo sem conta, `contaId` nulo, não entra na conta de teto
   * nenhuma, nunca disputa espaço com outro vídeo sem conta). Só no
   * segmento "Fora da curva" (`apenasIds` é o segmento "Salvos", uma lista
   * pequena e intencional, sem sentido limitar por conta ali). No máximo 2
   * cartões seguidos da mesma conta, no máximo 3 no total.
   */
  const comTetoPorConta = filtros.apenasIds
    ? comProporcao
    : aplicarTetoPorConta(comProporcao, (l) => l.contaId);

  return {
    total: contagem[0]?.total ?? 0,
    videos: comTetoPorConta
      .map((l) => paraVideoReferencia(l, regua, filtros.setores))
      .filter((v): v is VideoReferencia => v !== null),
  };
}

/**
 * R2b, item 1: o segmento "Todos", "todo vídeo do setor da marca que tem análise, sem o corte do
 * piso nem do múltiplo" (PROXIMO.md). Diferente de `referenciasDoNicho`: sem a cota de Brasil nem
 * o teto por conta (heurísticas de curadoria do "o que vale como prova", sem sentido numa visão de
 * volume "ver tudo"; a proporção do Brasil nas telas continua pendente do Gustavo só para a visão
 * curada, achado 2 da revisão do motor), então pagina direto em SQL (`limit`/`offset`), com `total`
 * exato pela mesma contagem em separado de sempre. Precisa de `semRegua: true` em
 * `condicoesReferencias` para tirar o piso, o múltiplo e o `serveDeModelo`.
 */
export async function todosOsVideosDoNicho(
  nichoId: number,
  filtros: FiltrosReferencias = {},
  pagina = 0,
): Promise<ResultadoReferencias> {
  const regua = await reguaDoSetor(nichoId);
  const tamanhoPagina = filtros.limite ?? TAMANHO_PAGINA_TODOS_PADRAO;
  const condicoes = condicoesReferencias(nichoId, filtros, regua, true);

  const [linhas, contagem] = await Promise.all([
    db()
      .select(CAMPOS_VIDEO_REFERENCIA)
      .from(videos)
      .leftJoin(contas, eq(contas.id, videos.contaId))
      .where(and(...condicoes))
      .orderBy(...ordenacaoReferencias(filtros.ordem))
      .limit(tamanhoPagina)
      .offset(pagina * tamanhoPagina),
    db()
      .select({ total: sql<number>`count(*)::int` })
      .from(videos)
      .leftJoin(contas, eq(contas.id, videos.contaId))
      .where(and(...condicoes)),
  ]);

  return {
    total: contagem[0]?.total ?? 0,
    videos: linhas.map((l) => paraVideoReferencia(l, regua, filtros.setores)).filter((v): v is VideoReferencia => v !== null),
  };
}

export type ContagensFiltroReferencias = {
  porPlataforma: Record<Plataforma, number>;
  porFormato: Record<AnaliseVideo["formato"], number>;
  /** R2b, item 2: as faixas de "mais de X views"; "qualquer" é sem o filtro. */
  porViewsMin: { qualquer: number; dezMil: number; cinquentaMil: number; cemMil: number; umMilhao: number };
  porPeriodo: { sete: number; trinta: number; noventa: number };
  porFala: { comFala: number; semFala: number };
  porBrasil: { brasil: number; fora: number };
  /** R2b, item 2: os dois valores de `tipoConteudo` que entram no filtro combinado "Tipo de vídeo". */
  porTipoConteudo: Record<TipoConteudoFiltravel, number>;
};

const FAIXAS_VIEWS = [
  { chave: "dezMil" as const, min: 10_000 },
  { chave: "cinquentaMil" as const, min: 50_000 },
  { chave: "cemMil" as const, min: 100_000 },
  { chave: "umMilhao" as const, min: 1_000_000 },
];

const TIPOS_CONTEUDO_FILTRAVEIS: TipoConteudoFiltravel[] = ["meme", "recorte"];

/**
 * A contagem que a folha "Filtrar" mostra ao lado de cada opção (V6, item 3; R2b, item 2): quantos
 * vídeos aquela opção devolveria, mantendo todos os OUTROS filtros como estão e ignorando só o
 * próprio eixo (README do passo 14, "Dúvidas", item 7: opção com zero ainda aparece, com "0").
 * Período, views, fala e Brasil não são colunas categóricas pequenas como plataforma/formato, então
 * cada opção vira a própria consulta (com o filtro daquele eixo recalculado para aquele valor),
 * em vez de um `GROUP BY`; mesmas condições de `referenciasDoNicho`/`todosOsVideosDoNicho`,
 * `semRegua` como a função que está chamando (R2b, item 1: "Todos" conta sem a régua também).
 */
export async function contagensPorFiltroReferencias(
  nichoId: number,
  filtros: Omit<FiltrosReferencias, "limite" | "ordem"> = {},
  semRegua = false,
): Promise<ContagensFiltroReferencias> {
  const regua = await reguaDoSetor(nichoId);

  async function contar(filtrosDaOpcao: Omit<FiltrosReferencias, "limite" | "ordem">): Promise<number> {
    const condicoes = condicoesReferencias(nichoId, filtrosDaOpcao, regua, semRegua);
    const [linha] = await db()
      .select({ total: sql<number>`count(*)::int` })
      .from(videos)
      .leftJoin(contas, eq(contas.id, videos.contaId))
      .where(and(...condicoes));
    return linha?.total ?? 0;
  }

  const [
    porPlataformaLinhas,
    porFormatoLinhas,
    porTipoConteudoLinhas,
    qualquer,
    dezMil,
    cinquentaMil,
    cemMil,
    umMilhao,
    sete,
    trinta,
    noventa,
    comFala,
    semFala,
    brasil,
    fora,
  ] = await Promise.all([
    db()
      .select({ plataforma: videos.plataforma, total: sql<number>`count(*)::int` })
      .from(videos)
      .leftJoin(contas, eq(contas.id, videos.contaId))
      .where(and(...condicoesReferencias(nichoId, { ...filtros, plataformas: undefined }, regua, semRegua)))
      .groupBy(videos.plataforma),
    db()
      .select({ formato: sql<string>`${videos.analise} ->> 'formato'`, total: sql<number>`count(*)::int` })
      .from(videos)
      .leftJoin(contas, eq(contas.id, videos.contaId))
      .where(
        and(...condicoesReferencias(nichoId, { ...filtros, formatos: undefined, tiposConteudo: undefined }, regua, semRegua)),
      )
      .groupBy(sql`${videos.analise} ->> 'formato'`),
    db()
      .select({ tipoConteudo: videos.tipoConteudo, total: sql<number>`count(*)::int` })
      .from(videos)
      .leftJoin(contas, eq(contas.id, videos.contaId))
      .where(
        and(...condicoesReferencias(nichoId, { ...filtros, formatos: undefined, tiposConteudo: undefined }, regua, semRegua)),
      )
      .groupBy(videos.tipoConteudo),
    contar({ ...filtros, viewsMin: undefined }),
    contar({ ...filtros, viewsMin: FAIXAS_VIEWS[0].min }),
    contar({ ...filtros, viewsMin: FAIXAS_VIEWS[1].min }),
    contar({ ...filtros, viewsMin: FAIXAS_VIEWS[2].min }),
    contar({ ...filtros, viewsMin: FAIXAS_VIEWS[3].min }),
    contar({ ...filtros, periodoDias: 7 }),
    contar({ ...filtros, periodoDias: 30 }),
    contar({ ...filtros, periodoDias: 90 }),
    contar({ ...filtros, comFala: true }),
    contar({ ...filtros, comFala: false }),
    contar({ ...filtros, brasil: true }),
    contar({ ...filtros, brasil: false }),
  ]);

  const porPlataforma = { youtube: 0, tiktok: 0, instagram: 0 } as Record<Plataforma, number>;
  for (const linha of porPlataformaLinhas) porPlataforma[linha.plataforma] = linha.total;

  const porFormato = {
    fala_para_camera: 0,
    podcast: 0,
    caixinha: 0,
    esquete: 0,
    outro: 0,
  } as Record<AnaliseVideo["formato"], number>;
  for (const linha of porFormatoLinhas) {
    if (linha.formato in porFormato) porFormato[linha.formato as AnaliseVideo["formato"]] = linha.total;
  }

  const porTipoConteudo = { meme: 0, recorte: 0 } as Record<TipoConteudoFiltravel, number>;
  for (const linha of porTipoConteudoLinhas) {
    if (linha.tipoConteudo && TIPOS_CONTEUDO_FILTRAVEIS.includes(linha.tipoConteudo as TipoConteudoFiltravel)) {
      porTipoConteudo[linha.tipoConteudo as TipoConteudoFiltravel] = linha.total;
    }
  }

  return {
    porPlataforma,
    porFormato,
    porTipoConteudo,
    porViewsMin: { qualquer, dezMil, cinquentaMil, cemMil, umMilhao },
    porPeriodo: { sete, trinta, noventa },
    porFala: { comFala, semFala },
    porBrasil: { brasil, fora },
  };
}

/**
 * A plataforma que a URL de `/referencias` pede, sem consultar o banco (V12b,
 * item 8): `?plataforma=todas` fecha o prefiltro de propósito ("Limpar os
 * filtros"); sem parâmetro nenhum e com uma rede principal na marca, ela só
 * entra como prefiltro se tiver ao menos um vídeo fora da curva no período
 * (`contagemPorPlataforma`, de `contagensPorFiltroReferencias`); sem vídeo
 * nenhum dela, a tela mostra todas e avisa por quê (achado do Gustavo com a
 * Dr.Wash no TikTok, coleta suspensa desde 09/09: a tela abria vazia sem
 * pista nenhuma). Um parâmetro explícito (a lista de uma ou mais
 * plataformas) sempre vence os dois casos acima.
 */
export function resolverPlataformasReferencias(
  parametroPlataforma: string | undefined,
  redePrincipal: Plataforma | null,
  contagemPorPlataforma: Record<Plataforma, number>,
): { plataformas: Plataforma[]; redePrincipalSemVideo?: Plataforma } {
  if (parametroPlataforma === "todas") return { plataformas: [] };

  if (parametroPlataforma === undefined) {
    if (!redePrincipal) return { plataformas: [] };
    if (contagemPorPlataforma[redePrincipal] > 0) return { plataformas: [redePrincipal] };
    return { plataformas: [], redePrincipalSemVideo: redePrincipal };
  }

  const plataformas = parametroPlataforma
    .split(",")
    .filter((v): v is Plataforma => v === "youtube" || v === "tiktok" || v === "instagram");
  return { plataformas };
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
  /** R2a: a capa do vídeo, para a moldura do reserva quando a rede não deixa mostrar o embed. */
  capaUrl: string | null;
  /** E44 PR 2: o tipo de vídeo da referência, para o selo "Tipo: ..." do roteiro. */
  formatoCatalogo: string | null;
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
      capaUrl: videos.capaUrl,
      formatoCatalogo: videos.formatoCatalogo,
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
    capaUrl: linha.capaUrl,
    formatoCatalogo: linha.formatoCatalogo,
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
  if (modelo.duracaoTipicaS) {
    linhas.push(`Duração típica: de ${modelo.duracaoTipicaS.min} a ${modelo.duracaoTipicaS.max} segundos.`);
  }
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

/** Menos que isso, acima do piso e dentro do setor em 30 dias, é "faltam contas semente" (M1, item 5b). */
export const LIMIAR_SETOR_ESTREITO = 10;

export type EstatisticasSetor = {
  videosAnalisados: number;
  dentroDoSetor: number;
  acimaDoPiso7Dias: number;
  acimaDoPiso30Dias: number;
  contasDistintasAcimaDoPiso30Dias: number;
  porRede: { plataforma: Plataforma; acimaDoPiso30Dias: number }[];
  setorEstreito: boolean;
};

/**
 * M1, item 5b: medido em produção em 30/09/2026 na Overtake Pro (com a análise feita à mão), o
 * setor ficou com 3 Referências em 30 dias e nenhum tema, porque 22 de 39 vídeos analisados
 * foram julgados fora do setor e só 3 passam do piso. Sem esta linha, o admin só via "48
 * transcritos" e não enxergava que a matéria-prima de verdade era pouca. Só leitura; a decisão
 * sobre o piso é do Gustavo (`config.regras.pisoViewsReferencia`).
 *
 * M2, item 0a da revisão do PR #73: a primeira versão de `acimaDoPiso` só exigia `foraDaCurva`
 * não nulo, sem o limiar de 1,5x nem `isNotNull(analise)`, então contava todo vídeo pontuado do
 * setor, não só o que `referenciasDoNicho` mostraria (medido em produção: Overtake Pro 33 contra
 * 2, perfil do Bruno 89 contra 10, Dr.Wash 1.043 contra 71). Corrigido reaproveitando
 * `condicoesReferencias`, as mesmas condições que a tela usa, para a contagem nunca divergir de
 * novo.
 */
export type EfeitoPiso = { acima7Dias: number; acima30Dias: number };

/**
 * M3, item 3: "ao mexer num dos três, a tela diz quantos vídeos do setor passariam nos últimos 7
 * e 30 dias com o valor novo". Só o piso de views muda uma contagem de verdade (as outras
 * condições de `condicoesReferencias` continuam as de agora): a proporção de vídeo brasileiro só
 * redistribui dentro do que já passa, nunca muda o total; "vídeo sem fala vale" não decide quem é
 * referência, decide quem ganha análise (`contagemElegivelSemFala`, `extrair-sem-fala.ts`).
 */
export async function efeitoPiso(nichoId: number, pisoViewsProposto: number): Promise<EfeitoPiso> {
  const reguaProposta: ReguaSetor = { pisoViews: pisoViewsProposto, proporcaoBrasil: 1, videoSemFalaVale: false };
  const acima = (dias: number) => and(...condicoesReferencias(nichoId, { periodoDias: dias }, reguaProposta));

  const [linha] = await db()
    .select({
      acima7Dias: sql<number>`count(*) filter (where ${acima(7)})::int`,
      acima30Dias: sql<number>`count(*) filter (where ${acima(30)})::int`,
    })
    .from(videos)
    .where(eq(videos.nichoId, nichoId));

  return { acima7Dias: linha?.acima7Dias ?? 0, acima30Dias: linha?.acima30Dias ?? 0 };
}

export async function estatisticasDoSetor(nichoId: number): Promise<EstatisticasSetor> {
  const regua = await reguaDoSetor(nichoId);
  const acimaDoPiso = (dias: number) => and(...condicoesReferencias(nichoId, { periodoDias: dias }, regua));

  // `count(...)` do Postgres devolve bigint, que o driver le como string em JS; ::int converte
  // na propria consulta (a contagem nunca chega perto de estourar um int de verdade aqui).
  const [linha] = await db()
    .select({
      videosAnalisados: sql<number>`count(*) filter (where ${isNotNull(videos.analise)})::int`,
      dentroDoSetor: sql<number>`count(*) filter (where ${isNotNull(videos.analise)} and ${PERTENCE_AO_NICHO})::int`,
      acimaDoPiso7Dias: sql<number>`count(*) filter (where ${acimaDoPiso(7)})::int`,
      acimaDoPiso30Dias: sql<number>`count(*) filter (where ${acimaDoPiso(30)})::int`,
      contasDistintasAcimaDoPiso30Dias: sql<number>`count(distinct ${videos.contaId}) filter (where ${acimaDoPiso(30)})::int`,
    })
    .from(videos)
    .where(eq(videos.nichoId, nichoId));

  const porRedeLinhas = await db()
    .select({
      plataforma: videos.plataforma,
      acimaDoPiso30Dias: sql<number>`count(*) filter (where ${acimaDoPiso(30)})::int`,
    })
    .from(videos)
    .where(eq(videos.nichoId, nichoId))
    .groupBy(videos.plataforma);

  return {
    videosAnalisados: linha?.videosAnalisados ?? 0,
    dentroDoSetor: linha?.dentroDoSetor ?? 0,
    acimaDoPiso7Dias: linha?.acimaDoPiso7Dias ?? 0,
    acimaDoPiso30Dias: linha?.acimaDoPiso30Dias ?? 0,
    contasDistintasAcimaDoPiso30Dias: linha?.contasDistintasAcimaDoPiso30Dias ?? 0,
    porRede: porRedeLinhas,
    setorEstreito: (linha?.acimaDoPiso30Dias ?? 0) < LIMIAR_SETOR_ESTREITO,
  };
}

/**
 * M1, item 5: Referências e a porta Reels de Hoje mostram um aviso diferente do "vazio" de sempre
 * quando o setor já tem vídeo coletado mas a análise ainda não rodou (nem pelo caminho imediato
 * nem pelo lote), em vez de parecer que não existe nada fora da curva ou nenhum tema. Uma
 * consulta só, sem o `porRede` de `estatisticasDoSetor` (que essas duas telas não precisam).
 */
export async function setorAindaLendo(nichoId: number): Promise<boolean> {
  const [linha] = await db()
    .select({
      total: sql<number>`count(*)::int`,
      analisados: sql<number>`count(*) filter (where ${isNotNull(videos.analise)})::int`,
    })
    .from(videos)
    .where(eq(videos.nichoId, nichoId));
  return (linha?.total ?? 0) > 0 && (linha?.analisados ?? 0) === 0;
}

/**
 * E45 PR 2 (decisão 35): o setor ainda não tem vídeo nenhum. É o que acontece com um ramo que acabou de nascer (a primeira marca que o escolheu, o
 * ramo provisório do "Não achei o meu", uma troca de ramo pela Conta): a pesquisa de setor e a primeira coleta ainda não deram nada. Os temas e as
 * referências dessa marca só vêm depois, e a tela diz isso em vez de "hoje não saiu tema" (como se algo tivesse falhado).
 * `setorAindaLendo` é o passo seguinte (tem vídeo, falta a análise).
 */
export async function setorSemBase(nichoId: number): Promise<boolean> {
  const [linha] = await db().select({ total: sql<number>`count(*)::int` }).from(videos).where(eq(videos.nichoId, nichoId));
  return (linha?.total ?? 0) === 0;
}
