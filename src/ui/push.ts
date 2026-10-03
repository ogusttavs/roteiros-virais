"use client";

/**
 * O aviso de manhã por push, do lado do navegador (E48 PR 2): se o aparelho suporta, em que estado está a permissão, e ligar ou desligar o aviso neste
 * aparelho. A permissão só se pede em resposta a um toque (`ligarAviso` é chamado direto do clique), e só dentro do aplicativo instalado (no iPhone a
 * permissão só existe lá). O que vai ao servidor é a inscrição (endpoint e as duas chaves); quem registra e apaga é a Server Action de quem chama.
 */

export type EstadoDoAviso =
  /** O navegador não tem service worker, push ou notificação (o iPhone fora do aplicativo instalado, por exemplo). */
  | "sem_suporte"
  /** A pessoa recusou nos ajustes do aparelho: só ela desfaz. */
  | "sem_permissao"
  /** Permissão dada e este aparelho está inscrito. */
  | "ligado"
  /** Dá para ligar: a permissão ainda não foi decidida, ou foi dada e a inscrição não existe. */
  | "desligado";

export function suportaPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** A chave pública VAPID (base64 sem padding, em formato de URL) vira os bytes que o `pushManager.subscribe` pede. */
export function chaveParaBytes(chave: string): Uint8Array<ArrayBuffer> {
  const preenchida = (chave + "=".repeat((4 - (chave.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = atob(preenchida);
  const bytes = new Uint8Array(new ArrayBuffer(bruto.length));
  for (let i = 0; i < bruto.length; i += 1) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}

/** A inscrição deste aparelho, se houver (precisa do service worker pronto). */
async function inscricaoDesteAparelho(): Promise<PushSubscription | null> {
  const registro = await navigator.serviceWorker.getRegistration("/");
  if (!registro) return null;
  return registro.pushManager.getSubscription();
}

export async function estadoDoAviso(): Promise<EstadoDoAviso> {
  if (!suportaPush()) return "sem_suporte";
  if (Notification.permission === "denied") return "sem_permissao";
  const inscricao = await inscricaoDesteAparelho().catch(() => null);
  return Notification.permission === "granted" && inscricao ? "ligado" : "desligado";
}

export type DadosDaInscricaoNoNavegador = { endpoint: string; p256dh: string; auth: string };

export type ResultadoDeLigar =
  | { tipo: "ligado"; inscricao: DadosDaInscricaoNoNavegador; /** O endereço da inscrição que foi trocada, para quem chama apagá-la no servidor (nulo se não havia). */ endpointAntigo: string | null }
  | { tipo: "negado" }
  | { tipo: "erro" };

/**
 * Pede a permissão (agora, no toque), registra o service worker e inscreve o aparelho com a chave pública. Devolve a inscrição para quem chama mandar
 * ao servidor; `negado` é a pessoa dizendo não ao pedido do navegador.
 */
export async function ligarAviso(chavePublica: string): Promise<ResultadoDeLigar> {
  if (!suportaPush() || !chavePublica) return { tipo: "erro" };
  try {
    // A primeira coisa assíncrona é o pedido: o navegador só o aceita em resposta ao toque.
    const permissao = await Notification.requestPermission();
    if (permissao !== "granted") return { tipo: "negado" };
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const registro = await navigator.serviceWorker.ready;
    // Sempre uma inscrição nova (A2): a que já existia pode ser de uma chave VAPID antiga ou apontar para um endereço que o serviço de push já não aceita, e é
    // exatamente o caso de quem volta a ligar o aviso depois de a inscrição ter sido apagada no servidor.
    const antiga = await registro.pushManager.getSubscription();
    const endpointAntigo = antiga?.endpoint ?? null;
    if (antiga) await antiga.unsubscribe().catch(() => false);
    const inscricao = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chavePublica) });
    const json = inscricao.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { tipo: "erro" };
    return { tipo: "ligado", inscricao: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }, endpointAntigo };
  } catch {
    return { tipo: "erro" };
  }
}

/** Tira a inscrição deste aparelho no navegador e devolve o endpoint, para quem chama apagar no servidor. */
export async function desligarAviso(): Promise<string | null> {
  const inscricao = await inscricaoDesteAparelho().catch(() => null);
  if (!inscricao) return null;
  const endpoint = inscricao.endpoint;
  await inscricao.unsubscribe().catch(() => false);
  return endpoint;
}

/** Os dados da inscrição deste aparelho no navegador (se houver), para reconciliar com o servidor quando a Conta abre. */
export async function inscricaoAtualDoAparelho(): Promise<DadosDaInscricaoNoNavegador | null> {
  const inscricao = await inscricaoDesteAparelho().catch(() => null);
  const json = inscricao?.toJSON();
  if (!json?.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}
