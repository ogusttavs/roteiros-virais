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
  /**
   * O filtro das notícias do ramo e a foto da matéria (fix de 22/10/2026): depois de cada coleta (06:00 e 14:00) para os ramos com marca ativa, e na hora em que uma marca chega num ramo
   * (briefing terminado, conta criada, ramo trocado, tela de Notícias aberta). `{ nichoId }` roda só aquele ramo; sem nada, todos os ramos com marca ativa.
   */
  filtrarNoticias: "filtrar-noticias",
  /** E55: o que está em alta no Brasil (buscas do Google e vídeos do YouTube), compartilhado por todos os setores; de madrugada e ao meio-dia. */
  tendenciasBrasil: "tendencias-brasil",
  contasBase: "contas-base",
  /** Instagram pela API oficial da Meta (E6 parte 3, segunda rodada, item 2); so agenda com config.coleta.metaAtivo. */
  metaContas: "meta-contas",
  /** Hashtag Search da Meta, semanal (E6 parte 3, segunda rodada, item 3); so agenda com config.coleta.metaAtivo. */
  metaHashtags: "meta-hashtags",
  /** Apify do Instagram, so descoberta de conta nova, semanal (E6 parte 3, segunda rodada, item 4); so agenda com config.coleta.metaAtivo. */
  descobertaInstagram: "descoberta-instagram",
  /**
   * Hotfix de 22/10/2026: baixa e guarda a capa dos vídeos do Instagram enquanto o link assinado do CDN vale (`jobs/guardar-capas.ts`). O worker enfileira ao fim de cada coleta que traz capa e na
   * partida; o cron é a reserva.
   */
  guardarCapas: "guardar-capas",
  pontuar: "pontuar",
  vigilancia: "vigilancia",
  /** A faxina das contas fora do setor, por ramo (22/10/2026): semanal, domingo antes da vigilancia e dos comentarios; `{ nichoId }` roda so aquele ramo. */
  faxinaDeContas: "faxina-de-contas",
  transcrever: "transcrever",
  extrair: "extrair",
  extrairColeta: "extrair-coleta",
  /** M1, item 1: setor com menos de 20 vídeos analisados não espera o lote. */
  extrairAgora: "extrair-agora",
  analisarVisual: "analisar-visual",
  /** E28: os comentários dos vídeos mais vistos do setor (YouTube), a leitura barata deles e as vozes do público; semanal, domingo antes da análise visual. */
  comentariosSemana: "comentarios-semana",
  /**
   * E52 (PR 2): a leitura dos vídeos longos do YouTube de cada setor (a transcrição dos poucos da semana e a leitura da estrutura); semanal, domingo de manhã. Job longo de
   * propósito (fora de `FILAS_CURTAS`): cada vídeo passa pelo proxy e pela Groq, um de cada vez.
   */
  lerLongos: "ler-longos",
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
  /** E26 4c: a faxina diaria das versoes do roteiro que ninguem escolheu, em grupos parados ha mais de 30 dias. */
  faxinaVersoes: "faxina-versoes",
  /** E19 PR 1: a renovacao diaria do acesso das contas de Instagram que as pessoas ligaram (e o aviso quando nao da mais). */
  renovarContasLigadas: "renovar-contas-ligadas",
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
  /**
   * E54, a pesquisa na hora: por evento (a pessoa pediu "Pesquisar antes de escrever"), `{ pesquisaId }`. Sem repetição automática
   * (cada tentativa gasta buscas pagas; a que cai vira "a pesquisa não terminou" e a pessoa decide) e sem horário.
   */
  pesquisaNaHora: "pesquisa-na-hora",
  /**
   * E56 PR 1, publicar no Instagram: por evento (o vídeo terminou de subir), `{ publicacaoId }`. Cada execução pergunta à Meta se o vídeo já está pronto e, estando, publica; se ainda não, agenda
   * a próxima pergunta (`startAfter`). Job curto: a conferência é idempotente (a reserva `processando` para `publicando` impede publicar duas vezes), então repetir por erro de rede é seguro.
   */
  publicarInstagram: "publicar-instagram",
} as const;

export type NomeFila = (typeof FILAS)[keyof typeof FILAS];

/**
 * Filas por evento, nunca por "rodar agora" do admin nem pelo cron
 * (segunda rodada do PR #42, item 2): `aprender-cliente` só roda com um
 * `clienteId`, que só `reprovarERescrever` sabe qual é; disparada sem isso,
 * o worker chama o job com `clienteId` indefinido e ele sempre quebra.
 */
export const FILAS_POR_EVENTO = new Set<string>([FILAS.aprenderCliente, FILAS.analisarPerfil, FILAS.pesquisaNaHora, FILAS.publicarInstagram]);

/**
 * As filas que aceitam rodar só para um ramo (`{ nichoId }` no disparo) e gravam o ramo em
 * `execucoes_job.ramo_id` (custo que falta no admin). É o que o botão "rodar de novo só este ramo"
 * do cartão da rotina oferece; as outras rodam sempre para todos os ramos de uma vez.
 */
export const FILAS_POR_RAMO = new Set<string>([
  FILAS.coletaYoutube,
  FILAS.coletaApify,
  FILAS.coletaNoticias,
  FILAS.filtrarNoticias,
  FILAS.metaContas,
  FILAS.metaHashtags,
  FILAS.descobertaInstagram,
  FILAS.transcrever,
  FILAS.extrairAgora,
  FILAS.extrairSemFala,
  FILAS.comentariosSemana,
  FILAS.faxinaDeContas,
  FILAS.lerLongos,
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
  FILAS.faxinaVersoes,
  FILAS.renovarContasLigadas,
  FILAS.aprenderCliente,
  FILAS.analisarPerfil,
  FILAS.publicarInstagram,
]);

const QUATRO_HORAS_S = 4 * 60 * 60;

/**
 * Pulso do worker (22/10/2026): enquanto um job roda, o pg-boss avisa o banco a cada metade deste prazo. Se o
 * processo morre no meio (kill -9, falta de memória, queda da máquina), o job fica `active` no banco; sem pulso,
 * ele só vence no `expireInSeconds` (4 horas nas filas longas) e, enquanto isso, o "rodar agora" do admin
 * recusa o disparo novo em silêncio, porque `existeJobPendente` conta o `active`. Com pulso, o monitor do
 * pg-boss (a cada 60 s) dá o job como falho 3 a 4 minutos depois da morte.
 */
export const PULSO_DO_WORKER_S = 180;

export type OpcoesFila = { retryLimit: number; retryBackoff: boolean; expireInSeconds: number; heartbeatSeconds: number };

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
    return { retryLimit: 2, retryBackoff: true, expireInSeconds: 15 * 60, heartbeatSeconds: PULSO_DO_WORKER_S };
  }
  return { retryLimit: 0, retryBackoff: false, expireInSeconds: QUATRO_HORAS_S, heartbeatSeconds: PULSO_DO_WORKER_S };
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
