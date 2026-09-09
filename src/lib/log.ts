/**
 * Logger de saida (stdout, capturado pelo Docker/Compose): existe para um
 * erro nao ficar so no Sentry, que ainda nao esta ligado em producao (sem
 * DSN, `Sentry.captureException` nao manda nada a lugar nenhum, achado do
 * PR #34, item 0a). `pino` ja era parte da stack declarada desde a etapa 1
 * (`package.json`), sem nenhum uso ate agora.
 *
 * `mascararSegredos` (E6 parte 3, segunda rodada, item 1): o token da Meta
 * (`META_TOKEN`) sempre comeca com "EAA"; em vez de listar campo por campo
 * onde ele pode aparecer, qualquer string logada que comece com "EAA" e
 * trocada por uma mascara, em qualquer profundidade do objeto.
 */
import pino from "pino";

const PREFIXO_TOKEN_META = "EAA";
const MASCARA = "***token mascarado***";

export function mascararSegredos(valor: unknown): unknown {
  if (typeof valor === "string") {
    return valor.startsWith(PREFIXO_TOKEN_META) ? MASCARA : valor;
  }
  if (Array.isArray(valor)) return valor.map(mascararSegredos);
  if (valor && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, mascararSegredos(item)]));
  }
  return valor;
}

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  formatters: {
    log(objeto) {
      return mascararSegredos(objeto) as Record<string, unknown>;
    },
  },
});
