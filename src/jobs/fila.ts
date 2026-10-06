/**
 * Conexao com o pg-boss e os nomes das filas (etapa 6, decisao do Fable:
 * pg-boss 12, API nova). Toda fila precisa existir antes de receber
 * trabalho (`createQueue`); consumir e `boss.work(nome, handler)`; enviar e
 * `boss.send(nome, dados, opcoes)`; agendar e
 * `boss.schedule(nome, cron, dados, { tz })`. A API antiga (subscribe,
 * publish) nao existe mais nesta versao; ver `node_modules/pg-boss/README.md`
 * e os `.d.ts` em `node_modules/pg-boss/dist/`.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";

import { db } from "@/db";

export const FILAS = {
  coletaYoutube: "coleta-youtube",
  coletaApify: "coleta-apify",
  /** Passada leve do meio-dia (E6 parte 3, terceira rodada, item 6); so agenda com config.coleta.coletaMeioDia. */
  coletaMeioDia: "coleta-meio-dia",
  coletaNoticias: "coleta-noticias",
  /** E55: o que está em alta no Brasil (buscas do Google e vídeos do YouTube), compartilhado por todos os setores; de madrugada e ao meio-dia. */
  tendenciasBrasil: "tendencias-brasil",
  contasBase: "contas-base",
  /** Instagram pela API oficial da Meta (E6 parte 3, segunda rodada, item 2); so agenda com config.coleta.metaAtivo. */
  metaContas: "meta-contas",
  /** Hashtag Search da Meta, semanal (E6 parte 3, segunda rodada, item 3); so agenda com config.coleta.metaAtivo. */
  metaHashtags: "meta-hashtags",
  /** Apify do Instagram, so descoberta de conta nova, semanal (E6 parte 3, segunda rodada, item 4); so agenda com config.coleta.metaAtivo. */
  descobertaInstagram: "descoberta-instagram",
  pontuar: "pontuar",
  vigilancia: "vigilancia",
  transcrever: "transcrever",
  extrair: "extrair",
  extrairColeta: "extrair-coleta",
  /** M1, item 1: setor com menos de 20 vídeos analisados não espera o lote. */
  extrairAgora: "extrair-agora",
  analisarVisual: "analisar-visual",
  /** M3, item 2: vídeo sem fala (quadros + legenda), diário, só para setor que aceita. */
  extrairSemFala: "extrair-sem-fala",
  modeloNicho: "modelo-nicho",
  temasDoDia: "temas-do-dia",
  /** M2: o setor nasce pesquisado (ao criar, "Pesquisar o mercado de novo" no admin, e mensal para os ativos). */
  pesquisaDeSetor: "pesquisa-de-setor",
  lembrete: "lembrete",
  curvaCliente: "curva-cliente",
  /** V10, item 4: e-mail diario para o Fable com o acompanhamento da viagem. */
  emailAcompanhamento: "email-acompanhamento",
  /** Por evento, nao por horario (E27, parte 2, item 2): reprovarERescrever enfileira depois de gravar a reprovacao. */
  aprenderCliente: "aprender-cliente",
  /** Por evento (E38, partes 2 e 3): um perfil citado foi adicionado, ou o perfil da propria marca mudou. */
  analisarPerfil: "analisar-perfil",
  /**
   * E38 PR 2, "o que entendemos da sua marca": dois modos na mesma fila. Sem `clienteId` (o cron
   * diário e o botão "rodar agora" do admin) é o despachante: enfileira só as marcas cuja última
   * leitura boa passou de `config.regras.diasEntreLeituraMarca`. Com `clienteId` (evento: a pessoa
   * salvou o site ou um perfil; ou o próprio despachante) lê aquela marca. Job longo de propósito
   * (fora de `FILAS_CURTAS`): ler o Instagram pode esperar a janela da Meta por quase uma hora, e
   * um prazo de 15 minutos com repetição leria o site do cliente de novo por cima do primeiro.
   */
  entenderMarca: "entender-marca",
} as const;

export type NomeFila = (typeof FILAS)[keyof typeof FILAS];

/**
 * Filas por evento, nunca por "rodar agora" do admin nem pelo cron
 * (segunda rodada do PR #42, item 2): `aprender-cliente` só roda com um
 * `clienteId`, que só `reprovarERescrever` sabe qual é; disparada sem isso,
 * o worker chama o job com `clienteId` indefinido e ele sempre quebra.
 */
export const FILAS_POR_EVENTO = new Set<string>([FILAS.aprenderCliente, FILAS.analisarPerfil]);

/**
 * As filas que aceitam rodar só para um ramo (`{ nichoId }` no disparo) e gravam o ramo em
 * `execucoes_job.ramo_id` (custo que falta no admin). É o que o botão "rodar de novo só este ramo"
 * do cartão da rotina oferece; as outras rodam sempre para todos os ramos de uma vez.
 */
export const FILAS_POR_RAMO = new Set<string>([
  FILAS.coletaYoutube,
  FILAS.coletaApify,
  FILAS.coletaNoticias,
  FILAS.metaContas,
  FILAS.metaHashtags,
  FILAS.descobertaInstagram,
  FILAS.transcrever,
  FILAS.extrairAgora,
  FILAS.extrairSemFala,
  FILAS.temasDoDia,
  FILAS.pesquisaDeSetor,
]);

let instancia: PgBoss | null = null;

function url(): string {
  const u = process.env.DATABASE_URL;
  if (!u) {
    throw new Error("DATABASE_URL nao definida. Copie .env.example para .env e rode npm run db:up.");
  }
  return u;
}

export function boss(): PgBoss {
  if (!instancia) {
    instancia = new PgBoss(url());
    instancia.on("error", (erro) => console.error("[pg-boss]", erro));
  }
  return instancia;
}

/**
 * Filas de job curto (segundos): continuam com 2 repeticoes para erro de rede. Todas as outras sao
 * job longo (coleta, pontuacao, transcricao, extracao, pesquisa de setor, temas), que nao repete.
 */
const FILAS_CURTAS = new Set<string>([
  FILAS.lembrete,
  FILAS.curvaCliente,
  FILAS.emailAcompanhamento,
  FILAS.aprenderCliente,
  FILAS.analisarPerfil,
]);

const QUATRO_HORAS_S = 4 * 60 * 60;

export type OpcoesFila = { retryLimit: number; retryBackoff: boolean; expireInSeconds: number };

/**
 * As opcoes de cada fila (hotfix de 01/10/2026). O prazo padrao do pg-boss para um job ativo e de
 * 15 minutos (`expireInSeconds`): passou disso, o job e dado como vencido e, com `retryLimit: 2`,
 * roda de novo por cima do que ainda esta rodando. Achado em producao: o `transcrever` (25 a 70
 * minutos) vinha rodando tres vezes toda madrugada (04:00, 04:15, 04:30), e a `pesquisa-de-setor`
 * mensal rodou tres vezes em 01/10, estourou a cota de busca do YouTube e gastou o resto do saldo
 * da API de IA. Job longo ganha 4 horas de prazo e nenhuma repeticao automatica (a rodada seguinte
 * do cron ja e a nova tentativa, e os jobs retomam de onde o banco parou); job curto continua com
 * 2 repeticoes e espera crescente.
 */
export function opcoesDaFila(nome: string): OpcoesFila {
  if (FILAS_CURTAS.has(nome)) {
    return { retryLimit: 2, retryBackoff: true, expireInSeconds: 15 * 60 };
  }
  return { retryLimit: 0, retryBackoff: false, expireInSeconds: QUATRO_HORAS_S };
}

/**
 * Cria as filas se ainda nao existirem e aplica as opcoes de `opcoesDaFila` (idempotente).
 * `createQueue` nao mexe numa fila que ja existe, entao o `updateQueue` em seguida e o que corrige
 * as filas criadas antes do hotfix de 01/10/2026 (producao). O handler de cada fila continua
 * decidindo se um erro especifico deve repetir (`src/jobs/execucoes.ts`, `ErroColeta`).
 */
export async function garantirFilas(): Promise<void> {
  const b = boss();
  for (const nome of Object.values(FILAS)) {
    const opcoes = opcoesDaFila(nome);
    await b.createQueue(nome, opcoes);
    await b.updateQueue(nome, opcoes);
  }
}

let prontoPromise: Promise<void> | null = null;

/**
 * Deixa o pg-boss pronto para enfileirar (`boss.start()` cria o schema se
 * for a primeira vez, `garantirFilas()` cria as filas), uma vez por
 * processo. Usado pela rota `POST /api/jobs/[nome]` (revisao da etapa 6,
 * parte 1, PROXIMO.md: a rota enfileira, nao roda o job na propria
 * requisicao). Se o Postgres do pg-boss estiver fora do ar, a promessa e
 * descartada para a proxima chamada tentar de novo, em vez de ficar presa
 * num erro antigo.
 */
export function garantirBossPronto(): Promise<void> {
  if (!prontoPromise) {
    prontoPromise = (async () => {
      await boss().start();
      await garantirFilas();
    })().catch((erro: unknown) => {
      prontoPromise = null;
      throw erro;
    });
  }
  return prontoPromise;
}

/**
 * Ja existe um job pendente (nao terminado) desta fila para este nicho
 * (etapa 24, parte 1, decisao 4 do PROXIMO.md: "coletar agora" nao duplica
 * job pendente do mesmo nicho). Le a tabela do proprio pg-boss em vez de um
 * mecanismo de deduplicacao da lib (singletonKey), para o criterio ficar
 * explicito e facil de testar.
 */
export async function existeJobPendente(nome: string, nichoId?: number): Promise<boolean> {
  // Sem `nichoId` (o disparo para todos os ramos): vale um pendente que também seja para todos. Com ele: um pendente daquele ramo.
  const resultado = await db().execute(sql`
    select 1
    from pgboss.job
    where name = ${nome}
      and ${nichoId === undefined ? sql`(data is null or data ->> 'nichoId' is null)` : sql`(data ->> 'nichoId')::int = ${nichoId}`}
      and state in ('created', 'retry', 'active')
    limit 1
  `);
  return resultado.rows.length > 0;
}
