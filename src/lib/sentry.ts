/**
 * Sentry no app (`@sentry/nextjs`) e no worker (`@sentry/node`), etapa 13,
 * decisão 1 do `PROXIMO.md`: só no servidor, sem `withSentryConfig` (exige
 * token de build para os source maps, fica para quando a conta existir) e
 * sem erro de cliente (navegador) nesta rodada. `deveInicializarSentry` é
 * pura para o teste unitário não depender de `process.env` real: sem
 * `SENTRY_DSN` (a VPS ainda não tem essa conta, `acessos/VPS.md`), nada
 * muda no comportamento.
 */
import { config } from "@/lib/config";

export function deveInicializarSentry(dsn: string): boolean {
  return dsn.length > 0;
}

/**
 * `environment` vem do `NODE_ENV` de verdade; `release` fica vazio fora dos containers publicados.
 *
 * `tracePropagationTargets: []` (E38 PR 2): sem isto o Sentry anexa `sentry-trace` e `baggage` (release,
 * ambiente e chave pública) a TODA requisição de saída do `fetch`, e o leitor de site passa a pedir
 * páginas de sites de clientes (`src/jobs/site-api.ts`). Lista vazia = não propaga o rastreio para
 * ninguém; o Sentry continua capturando os erros daqui normalmente.
 */
export function opcoesSentry(): {
  dsn: string;
  environment: string;
  release: string | undefined;
  tracePropagationTargets: string[];
} {
  return {
    dsn: config.sentryDsn,
    environment: process.env.NODE_ENV ?? "development",
    release: config.gitSha || undefined,
    tracePropagationTargets: [],
  };
}
