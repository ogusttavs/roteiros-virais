/**
 * A coleta quente de notícias (25/11/2026): uma rodada leve a cada 2 horas, das 08:00 às 20:00, só dos ramos que têm alguém usando o aplicativo. Fica desligada até a sessão central medir o
 * peso no servidor (2 processadores divididos com outro produto); liga com `NOTICIAS_QUENTES_ATIVO=1` no ambiente do worker. Lida aqui, na hora de agendar, e não em `lib/config.ts`.
 */
export const CRON_DA_COLETA_QUENTE = "0 8-20/2 * * *";

export function noticiasQuentesAtivo(): boolean {
  const valor = (process.env.NOTICIAS_QUENTES_ATIVO ?? "").trim().toLowerCase();
  return valor === "1" || valor === "true" || valor === "sim";
}
