import "dotenv/config";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

function env(nome: string, padrao = ""): string {
  const v = process.env[nome];
  return v === undefined || v === "" ? padrao : v;
}

function envNumero(nome: string, padrao: number): number {
  const v = process.env[nome];
  if (v === undefined || v === "") return padrao;
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
}

export type ProvedorIA = "anthropic" | "mock";

function provedorIA(): ProvedorIA {
  const p = env("AI_PROVIDER");
  if (p === "anthropic" || p === "mock") return p;
  return env("ANTHROPIC_API_KEY") ? "anthropic" : "mock";
}

export const config = {
  appName: env("APP_NAME", "seu painel"),
  appUrl: env("APP_URL", "http://localhost:3000"),
  jobsApiKey: env("JOBS_API_KEY", ""),
  auth: {
    secret: env("BETTER_AUTH_SECRET", "troque-em-producao"),
    url: env("BETTER_AUTH_URL", "http://localhost:3000"),
  },
  /**
   * Modo da suíte e2e (etapa 13, parte 3, ajuste da revisão): `next start`
   * sempre roda com `NODE_ENV=production`, mas a suíte não pode se
   * comportar como produção de verdade em dois pontos.
   *
   * (1) O better-auth liga sozinho, só em produção, um limite de taxa
   * embutido em `/sign-in*` (3 tentativas a cada 10 s, não configurável por
   * fora, `getDefaultSpecialRules` do pacote); várias telas da suíte entram
   * pela mesma conta de exemplo em sequência, o que basta para estourar
   * esse limite (`src/lib/auth.ts`).
   *
   * (2) `enviarEmail` só simula fora de produção; a suíte rodando contra
   * `next start` mandou e-mail de verdade pelo Resend para
   * `cliente-e2e@exemplo.teste` (domínio inexistente, bounce), porque o
   * `.env` local tinha a chave real (achado da revisão desta etapa).
   *
   * `verificarSegredosDeProducao`, abaixo, recusa `MODO_E2E=1` fora de
   * `localhost`/`127.0.0.1`: essa flag só existe para o `webServer.env` do
   * `playwright.config.ts` e nunca pode valer na VPS de verdade.
   */
  modoE2E: env("MODO_E2E") === "1",
  ia: {
    provedor: provedorIA(),
    modeloForte: env("AI_MODEL_FORTE", "claude-opus-5"),
    modeloBarato: env("AI_MODEL_BARATO", "claude-haiku-4-5"),
  },
  transcricao: {
    groqKey: env("GROQ_API_KEY"),
    groqModel: env("GROQ_MODEL", "whisper-large-v3-turbo"),
  },
  coleta: {
    youtubeKey: env("YOUTUBE_API_KEY"),
    apifyToken: env("APIFY_TOKEN"),
    atorTiktok: env("APIFY_ACTOR_TIKTOK", "clockworks/tiktok-scraper"),
    atorInstagram: env("APIFY_ACTOR_INSTAGRAM", "apify/instagram-scraper"),
    /** `maxItems` de cada chamada ao ator (PROXIMO.md, etapa 6 parte 2): 50 em desenvolvimento, 200 em producao. */
    apifyMaxItems: envNumero("APIFY_MAX_ITEMS", process.env.NODE_ENV === "production" ? 200 : 50),
    /** Teto diario de resultados do Apify (fonte "apify" em consumo_api), somando TikTok e Instagram. */
    apifyMaxResultadosDia: envNumero("APIFY_MAX_RESULTADOS_DIA", 1000),
  },
  email: {
    resendKey: env("RESEND_API_KEY"),
    de: env("EMAIL_FROM", "painel@localhost"),
  },
  /** Contato mostrado em /termos e /privacidade (etapa 12, decisao 7). */
  emailContato: env("EMAIL_CONTATO", "contato@localhost"),
  /** Vazio ate o Gustavo criar a conta (etapa 13, decisao 1); sem DSN, o Sentry nao inicia. */
  sentryDsn: env("SENTRY_DSN"),
  /**
   * Sha curto do commit (etapa 13, decisao 1): vira `release` no Sentry.
   * Passado como build-arg pelo workflow "Imagens" para os Dockerfiles do
   * app e do worker; vazio fora desses containers (dev local, testes).
   */
  gitSha: env("GIT_SHA"),
  /** Regras de produto que sao decisao, nao opiniao (CLAUDE.md e briefing-e-rubricas.md) */
  regras: {
    notaMinimaBriefing: 8,
    notaMinimaTema: 9,
    vigilanciaPorNicho: 50,
    limiarForaDaCurva: 3,
    transcricoesPorDia: 40,
    visuaisPorSemana: 10,
    /** Teto de vídeos com análise usados como evidência do modelo do nicho (etapa 9, decisão 2 do PROXIMO.md: "30 a 60"). */
    videosParaModeloNicho: 60,
    /** Piso de vídeos usados como evidência do modelo do nicho (etapa 10, ajuste da revisão da etapa 9): abaixo de `limiarForaDaCurva`, completa até aqui em vez de modelar com pouca evidência. */
    minimoEvidenciaModeloNicho: 10,
    janelaLinhaEditorial: 15,
    minimoParaAvisoLinhaEditorial: 5,
  },
};

const SEGREDO_PADRAO = "troque-em-producao";

export class ErroConfiguracao extends Error {}

/**
 * Em producao, recusa iniciar se o segredo de sessao ou a chave de jobs
 * ainda forem o valor de exemplo do .env.example (etapa 4, revisao da
 * etapa 3). Roda sozinha ao carregar este modulo; exportada para testar com
 * um ambiente fabricado, sem depender do process.env real.
 *
 * `next build` roda com NODE_ENV=production mesmo local, sem os segredos
 * reais (que so existem no container em producao); NEXT_PHASE distingue
 * esse passo de build do servidor rodando de verdade (etapa 4, achado ao
 * rodar `npm run build` local com o .env.example ainda no .env).
 */
/** `null` sem host valido (URL ausente ou malformada): tratado como reprovado por MODO_E2E. */
function hostDeUrl(valor: string | undefined): string | null {
  if (!valor) return null;
  try {
    return new URL(valor).hostname;
  } catch {
    return null;
  }
}

export function verificarSegredosDeProducao(
  env: {
    NODE_ENV?: string;
    NEXT_PHASE?: string;
    BETTER_AUTH_SECRET?: string;
    JOBS_API_KEY?: string;
    MODO_E2E?: string;
    APP_URL?: string;
    BETTER_AUTH_URL?: string;
  } = process.env,
): void {
  if (env.NODE_ENV !== "production") return;
  if (env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;

  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET === SEGREDO_PADRAO) {
    throw new ErroConfiguracao(
      "BETTER_AUTH_SECRET ainda e o valor de exemplo do .env.example; gere um segredo de verdade antes de subir em producao.",
    );
  }
  if (!env.JOBS_API_KEY || env.JOBS_API_KEY === SEGREDO_PADRAO) {
    throw new ErroConfiguracao(
      "JOBS_API_KEY ainda e o valor de exemplo do .env.example; gere uma chave de verdade antes de subir em producao.",
    );
  }

  /**
   * MODO_E2E desliga o limite de taxa do better-auth e o envio de e-mail de
   * verdade (config.modoE2E, src/lib/auth.ts, src/lib/email.ts); sem essa
   * trava, a mesma flag num `.env` de producao de verdade abriria as duas
   * brechas na VPS. So vale com APP_URL e BETTER_AUTH_URL em localhost ou
   * 127.0.0.1, o unico jeito de rodar de verdade `next start` para a suite
   * e2e (etapa 13, parte 3, ajuste da revisao: e-mail real saiu pelo Resend
   * numa rodada da suite antes desta trava existir).
   */
  if (env.MODO_E2E === "1") {
    const HOSTS_PERMITIDOS = new Set(["localhost", "127.0.0.1"]);
    for (const [nome, valor] of [
      ["APP_URL", env.APP_URL],
      ["BETTER_AUTH_URL", env.BETTER_AUTH_URL],
    ] as const) {
      const host = hostDeUrl(valor);
      if (!host || !HOSTS_PERMITIDOS.has(host)) {
        throw new ErroConfiguracao(
          `MODO_E2E=1 exige ${nome} em localhost ou 127.0.0.1; recebido "${valor}". Essa flag nunca pode valer fora do e2e.`,
        );
      }
    }
  }
}

verificarSegredosDeProducao();

export function hojeISO(d = new Date()): string {
  // Data local do Brasil (o servidor pode estar em UTC)
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/**
 * "HH:00" na hora local do Brasil (etapa 12, decisão 5 do `PROXIMO.md`: o
 * job `lembrete` roda de hora em hora e compara com `clientes.hora_lembrete`,
 * que também é "HH:00").
 */
export function horaAtualISO(d = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  });
  return `${fmt.format(d)}:00`;
}
