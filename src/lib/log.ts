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
 *
 * `Error` vira `{ nome, mensagem, pilha }` antes de mascarar (achado da
 * leitura previa do Fable, 09/09/2026, correcao 2): `Object.entries(new
 * Error(...))` e vazio (mensagem e pilha nao sao enumeraveis), entao um
 * `Error` caindo no ramo generico de objeto virava `{}`, apagando a
 * mensagem e a pilha (era o caso da rota do PDF, item 0a). O campo do
 * `logger.error` passa a se chamar `err`, nao `erro`: e o nome que o
 * serializador padrao do pino reconhece.
 *
 * Mascara por trecho, nao por prefixo (ajuste 3 da revisao do PR #35): o
 * token vai na URL da Graph API (`access_token=EAA...`), entao uma string
 * que so comeca com "EAA" quando o token e o valor inteiro nunca cobria um
 * erro que logasse a URL inteira. `/EAA[A-Za-z0-9]+/g` troca a ocorrencia
 * onde ela estiver na string, mantendo o resto.
 */
import pino from "pino";

const PADRAO_TOKEN_META = /EAA[A-Za-z0-9]+/g;
const MASCARA = "***token mascarado***";

export function mascararSegredos(valor: unknown): unknown {
  if (typeof valor === "string") {
    return valor.replace(PADRAO_TOKEN_META, MASCARA);
  }
  if (Array.isArray(valor)) return valor.map(mascararSegredos);
  if (valor instanceof Error) {
    return {
      nome: valor.name,
      mensagem: mascararSegredos(valor.message),
      pilha: mascararSegredos(valor.stack),
    };
  }
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
