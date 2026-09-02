import "dotenv/config";

function env(nome: string, padrao = ""): string {
  const v = process.env[nome];
  return v === undefined || v === "" ? padrao : v;
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
  },
  email: {
    resendKey: env("RESEND_API_KEY"),
    de: env("EMAIL_FROM", "painel@localhost"),
  },
  /** Regras de produto que sao decisao, nao opiniao (CLAUDE.md e briefing-e-rubricas.md) */
  regras: {
    notaMinimaBriefing: 8,
    notaMinimaTema: 9,
    vigilanciaPorNicho: 50,
    limiarForaDaCurva: 3,
    transcricoesPorDia: 40,
    visuaisPorSemana: 10,
    janelaLinhaEditorial: 15,
    minimoParaAvisoLinhaEditorial: 5,
  },
};

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
