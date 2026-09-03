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
import { PgBoss } from "pg-boss";

export const FILAS = {
  coletaYoutube: "coleta-youtube",
  coletaApify: "coleta-apify",
  coletaNoticias: "coleta-noticias",
} as const;

export type NomeFila = (typeof FILAS)[keyof typeof FILAS];

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
 * Cria as filas se ainda nao existirem (idempotente). Repeticao: 2
 * tentativas com espera crescente para erro de rede (`retryBackoff`); o
 * handler de cada fila decide se um erro especifico deve mesmo repetir
 * (`src/jobs/execucoes.ts`, `ErroColeta`).
 */
export async function garantirFilas(): Promise<void> {
  const b = boss();
  for (const nome of Object.values(FILAS)) {
    await b.createQueue(nome, { retryLimit: 2, retryBackoff: true });
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
