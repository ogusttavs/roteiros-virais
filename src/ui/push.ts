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

/** Em que passo o `ligarAviso` falhou (item 0d: o iPhone devolvia só "não deu" e ninguém sabia onde). */
export type EtapaDoAviso = "suporte" | "chave" | "permissao" | "registro" | "pronto" | "assinatura" | "inscricao" | "servidor";

export type ResultadoDeLigar =
  | { tipo: "ligado"; inscricao: DadosDaInscricaoNoNavegador; /** O endereço da inscrição que foi trocada, para quem chama apagá-la no servidor (nulo se não havia). */ endpointAntigo: string | null }
  | { tipo: "negado" }
  | { tipo: "erro"; etapa: EtapaDoAviso; motivo: string };

/** O nome e a mensagem do erro, sem mais nada (nunca o endereço nem uma chave). */
export function descreverErro(erro: unknown): string {
  if (erro instanceof Error) return `${erro.name}: ${erro.message}`.slice(0, 300);
  return String(erro).slice(0, 300);
}

/** O service worker que não fica pronto não pode deixar a pessoa esperando para sempre (o iPhone no aplicativo instalado já demorou muito para isso). */
const ESPERA_DO_SERVICE_WORKER_MS = 10_000;

/**
 * Pede a permissão (agora, no toque), registra o service worker e inscreve o aparelho com a chave pública. Devolve a inscrição para quem chama mandar
 * ao servidor; `negado` é a pessoa dizendo não ao pedido do navegador; `erro` diz em que passo falhou e por quê (para o admin ver na tela e o log guardar).
 */
export async function ligarAviso(chavePublica: string): Promise<ResultadoDeLigar> {
  if (!suportaPush()) return { tipo: "erro", etapa: "suporte", motivo: "o navegador não tem service worker, push ou notificação" };
  const chave = chavePublica.trim();
  if (!chave) return { tipo: "erro", etapa: "chave", motivo: "sem chave pública no servidor" };
  let aplicacao: Uint8Array<ArrayBuffer>;
  try {
    aplicacao = chaveParaBytes(chave);
  } catch (erro) {
    return { tipo: "erro", etapa: "chave", motivo: descreverErro(erro) };
  }
  // Uma chave pública P-256 sem compressão tem 65 bytes e começa com 0x04; qualquer outra coisa o navegador recusa com um erro que não diz o porquê.
  if (aplicacao.length !== 65 || aplicacao[0] !== 0x04) return { tipo: "erro", etapa: "chave", motivo: `a chave pública tem ${aplicacao.length} bytes (esperado 65, começando em 4)` };

  let etapa: EtapaDoAviso = "permissao";
  try {
    // A primeira coisa assíncrona é o pedido: o navegador só o aceita em resposta ao toque.
    const permissao = await Notification.requestPermission();
    if (permissao !== "granted") return { tipo: "negado" };
    etapa = "registro";
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    etapa = "pronto";
    const registro = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, falhou) => setTimeout(() => falhou(new Error("o service worker não ficou pronto em 10 segundos")), ESPERA_DO_SERVICE_WORKER_MS)),
    ]);
    etapa = "assinatura";
    // Sempre uma inscrição nova (A2): a que já existia pode ser de uma chave VAPID antiga ou apontar para um endereço que o serviço de push já não aceita, e é
    // exatamente o caso de quem volta a ligar o aviso depois de a inscrição ter sido apagada no servidor.
    const antiga = await registro.pushManager.getSubscription();
    const endpointAntigo = antiga?.endpoint ?? null;
    if (antiga) await antiga.unsubscribe().catch(() => false);
    const inscricao = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aplicacao });
    etapa = "inscricao";
    const json = inscricao.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { tipo: "erro", etapa, motivo: "sem chaves na inscrição" };
    return { tipo: "ligado", inscricao: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }, endpointAntigo };
  } catch (erro) {
    return { tipo: "erro", etapa, motivo: descreverErro(erro) };
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
