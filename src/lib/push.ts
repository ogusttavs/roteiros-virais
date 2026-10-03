/**
 * O envio do aviso por push (E48 PR 2), com a biblioteca `web-push` e as chaves VAPID do `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
 * `VAPID_SUBJECT`; gerar com `npx web-push generate-vapid-keys`). Mesma regra do e-mail: fora de produção (e na suíte e2e) o aviso sai no log em vez
 * de ser enviado de verdade, para ninguém receber notificação de teste no aparelho de verdade.
 */
import webpush from "web-push";

import { config } from "./config";
import { logger } from "./log";

export type InscricaoParaEnvio = { endpoint: string; p256dh: string; auth: string };

export type AvisoPush = { titulo: string; corpo: string; url: string };

export type ResultadoDoEnvio =
  /** O serviço de push aceitou o aviso. */
  | { ok: true }
  /**
   * `apagar`: 404 ou 410, o aparelho não existe mais (a inscrição vale zero). `contar`: a falha é do aparelho (um 4xx que não é de credencial nem de limite) e
   * soma uma falha seguida; as chaves faltando ou erradas (401, 403 ou VAPID ausente), o limite do serviço (429), uma queda dele (5xx) e a rede caída
   * NÃO contam, porque não dizem nada sobre o aparelho e apagariam a inscrição de todo mundo por um problema nosso ou do serviço.
   */
  | { ok: false; apagar: boolean; contar: boolean; motivo: string };

/** Só o 4xx que fala do aparelho conta como falha dele (a segunda seguida apaga a inscrição). */
export function falhaContaParaOAparelho(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 404 && status !== 410 && status !== 429;
}

/** As chaves estão no ambiente? Sem elas nenhum push sai, e o job cai no e-mail para todo mundo (o que era antes deste PR). */
export function pushConfigurado(): boolean {
  return Boolean(config.push.publicKey && config.push.privateKey && config.push.subject);
}

let configurado = false;

function configurarWebPush() {
  if (configurado) return;
  webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
  configurado = true;
}

/**
 * Manda um aviso a um aparelho. Nunca lança: o resultado diz se o serviço aceitou e, se não, se a inscrição deve ser apagada na hora (404 e 410, o
 * aparelho foi desinstalado ou o usuário revogou) ou só contar uma falha.
 */
export async function enviarPush(inscricao: InscricaoParaEnvio, aviso: AvisoPush): Promise<ResultadoDoEnvio> {
  const producao = process.env.NODE_ENV === "production";
  if (!producao || config.modoE2E) {
    logger.info({ endpoint: inscricao.endpoint.slice(0, 40), titulo: aviso.titulo, corpo: aviso.corpo }, "[push simulado]");
    return { ok: true };
  }
  if (!pushConfigurado()) return { ok: false, apagar: false, contar: false, motivo: "chaves VAPID nao configuradas" };
  try {
    configurarWebPush();
    await webpush.sendNotification(
      { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } },
      JSON.stringify(aviso),
      // O `timeout` evita que um endereço que aceita a conexão e não responde prenda o job inteiro (o laço de aparelhos e o de pessoas são em sequência).
      { TTL: 60 * 60 * 6, timeout: 10_000 },
    );
    return { ok: true };
  } catch (erro) {
    const status = typeof erro === "object" && erro !== null && "statusCode" in erro ? Number((erro as { statusCode: unknown }).statusCode) : undefined;
    return {
      ok: false,
      apagar: status === 404 || status === 410,
      contar: falhaContaParaOAparelho(status),
      motivo: status ? `servico de push respondeu ${status}` : erro instanceof Error ? erro.message : String(erro),
    };
  }
}
