/**
 * Sentry no app (etapa 13, decisão 1 do `PROXIMO.md`): `Sentry.init` manual,
 * sem `withSentryConfig` em `next.config.ts` (isso exige token de build para
 * subir source maps, fica para quando a conta existir). Roda só no runtime
 * Node (nunca no edge, onde o middleware roda) e só quando `SENTRY_DSN`
 * existir; sem ele, `register` não faz nada.
 */
export async function register(): Promise<void> {
  /**
   * O `if` precisa desse formato exato (runtime dentro do bloco, não um
   * "return" antecipado negado): o Next.js só deixa de empacotar o import
   * dinâmico para o runtime edge quando reconhece esse padrão, e o edge
   * (onde o middleware roda) não tem os módulos nativos do Node que
   * `dotenv` (importado por `@/lib/config`) usa.
   */
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { deveInicializarSentry, opcoesSentry } = await import("@/lib/sentry");
    const opcoes = opcoesSentry();
    if (deveInicializarSentry(opcoes.dsn)) {
      const Sentry = await import("@sentry/nextjs");
      Sentry.init(opcoes);
    }
  }
}
