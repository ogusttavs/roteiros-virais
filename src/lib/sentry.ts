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
  beforeBreadcrumb: <B>(breadcrumb: B) => B;
  beforeSend: <E>(evento: E) => E;
  beforeSendTransaction: <E>(evento: E) => E;
} {
  return {
    dsn: config.sentryDsn,
    environment: process.env.NODE_ENV ?? "development",
    release: config.gitSha || undefined,
    tracePropagationTargets: [],
    beforeBreadcrumb: limparSentry,
    beforeSend: limparSentry,
    beforeSendTransaction: limparSentry,
  };
}

/**
 * Revisão do Fable de 27/10/2026, achado 5: o SDK guarda a query da chamada de saída num breadcrumb de `fetch`, no campo `http.query` (conferido em
 * `@sentry/node-core`, `outgoingFetchRequest.js`: a `url` sai sem a query, mas `data["http.query"] = parsedUrl.search` entra inteira). As chamadas à Graph API levam `access_token` e, na troca de
 * acesso, `client_secret` na query. Tudo o que vai ao Sentry (breadcrumbs, evento, transação) passa por aqui antes de sair, e o valor dessas chaves vira `[removido]`.
 */
const CHAVES_NA_QUERY = ["access_token", "client_secret", "code", "refresh_token", "appsecret_proof", "fb_exchange_token", "ig_exchange_token", "token", "password", "senha"];
/** Em objeto, `code` fica de fora: é o campo de código de erro (números e `ECONNRESET`), e a query com `code=` já é limpa pelo texto. */
const CHAVES_DE_OBJETO = new Set(CHAVES_NA_QUERY.filter((c) => c !== "code"));
const REMOVIDO = "[removido]";
const PROFUNDIDADE_MAXIMA = 12;

const PADRAO_NA_QUERY = new RegExp(`(^|[?&;\\s"'])(${CHAVES_NA_QUERY.join("|")})=[^&#\\s"']*`, "gi");

/** Troca o valor das chaves secretas num texto com query (`?access_token=abc&x=1`, `http.query`, endereço inteiro, mensagem de erro). */
export function limparTextoComQuery(texto: string): string {
  return texto.replace(PADRAO_NA_QUERY, (_inteiro, antes: string, chave: string) => `${antes}${chave}=${REMOVIDO}`);
}

function limpar(valor: unknown, profundidade: number): unknown {
  if (typeof valor === "string") return limparTextoComQuery(valor);
  if (valor === null || typeof valor !== "object" || profundidade >= PROFUNDIDADE_MAXIMA) return valor;
  if (Array.isArray(valor)) {
    for (let i = 0; i < valor.length; i += 1) valor[i] = limpar(valor[i], profundidade + 1);
    return valor;
  }
  const objeto = valor as Record<string, unknown>;
  for (const chave of Object.keys(objeto)) {
    const atual = objeto[chave];
    if (typeof atual === "string" && CHAVES_DE_OBJETO.has(chave.toLowerCase())) objeto[chave] = REMOVIDO;
    else objeto[chave] = limpar(atual, profundidade + 1);
  }
  return valor;
}

/** Limpa um breadcrumb ou um evento (erro ou transação) no próprio objeto e o devolve; serve de `beforeBreadcrumb`, `beforeSend` e `beforeSendTransaction`. */
export function limparSentry<T>(entrada: T): T {
  return limpar(entrada, 0) as T;
}
