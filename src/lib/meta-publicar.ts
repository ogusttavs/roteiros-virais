/**
 * E56 PR 1: publicar um vídeo no Instagram da própria marca pela Graph API, sem banco e sem Next. O fluxo, na ordem da documentação baixada em `pesquisa/plataformas/docs/meta/`
 * (`publicacao-de-conteudo.md`, `publicacao-ig-user-media.md`, `publicacao-ig-user-media-publish.md`, `publicacao-ig-user-limite.md`, `publicacao-ig-container.md`):
 *   1. cria o contêiner com `upload_type=resumable` (`media_type` REELS ou STORIES): a Meta devolve o id do contêiner;
 *   2. manda os bytes do vídeo para `rupload.facebook.com/ig-api-upload/<versão>/<contêiner>` com `offset` e `file_size` (o vídeo passa do navegador direto para a Meta: nada fica guardado aqui);
 *   3. pergunta `status_code` do contêiner até FINISHED (a Meta pede no máximo uma pergunta por minuto, por até 5 minutos);
 *   4. publica (`media_publish` com `creation_id`), e lê o endereço da mídia publicada.
 * O uso do dia vem de `content_publishing_limit`. O acesso (token) entra como argumento e NUNCA vai para log, erro ou retorno; as mensagens de erro são as de `ErroMetaLogin`, sem endereço. Nos
 * testes o `fetch` é simulado; a chamada de verdade recusa rodar dentro do Vitest sem isso.
 */
import type { TipoDePublicacao } from "@/db/schema";
import { conferirQueNaoEhRedeDeVerdade, enderecoDoRupload, ErroMetaLogin, pedirGraph } from "@/lib/meta-oauth";

export type StatusDoContainer = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";
const STATUS_CONHECIDOS: readonly string[] = ["EXPIRED", "ERROR", "FINISHED", "IN_PROGRESS", "PUBLISHED"];

/** Falha do envio dos bytes. `tentarDeNovo` é o `retriable` do `debug_info` da Meta (ela diz se vale tentar de novo). */
export class ErroDeEnvioDoVideo extends ErroMetaLogin {
  constructor(
    message: string,
    public readonly tentarDeNovo: boolean,
    codigo?: number,
  ) {
    super(message, codigo);
  }
}

/** Passo 1: o contêiner de envio retomável. Story não leva legenda (a documentação não a prevê para Story). */
export async function criarContainerDeVideo(entrada: { igId: string; token: string; tipo: TipoDePublicacao; legenda: string }): Promise<{ containerId: string }> {
  const { igId, token, tipo, legenda } = entrada;
  const parametros: Record<string, string> = { media_type: tipo === "story" ? "STORIES" : "REELS", upload_type: "resumable" };
  if (tipo === "reels") {
    // `share_to_feed=true`: o Reel aparece no perfil e no Feed, além da aba Reels (`publicacao-ig-user-media.md`, `share_to_feed`).
    parametros.share_to_feed = "true";
    if (legenda.trim()) parametros.caption = legenda;
  }
  const corpo = await pedirGraph<{ id?: unknown }>(`${igId}/media`, parametros, token, "POST");
  if (typeof corpo.id !== "string" || corpo.id === "") throw new ErroMetaLogin("A Meta nao devolveu o conteiner da publicacao.");
  return { containerId: corpo.id };
}

function codigoDentroDoDebug(mensagem: string | undefined): number | undefined {
  if (!mensagem) return undefined;
  const achado = /"code"\s*:\s*(\d+)/.exec(mensagem);
  return achado ? Number(achado[1]) : undefined;
}

/**
 * Passo 2: manda os bytes. `corpo` pode ser um fluxo (o pedido do navegador, repassado sem guardar) ou os bytes inteiros. `tamanho` é o `file_size`: precisa ser o tamanho exato do arquivo. A
 * Meta responde `{ success: true }`; numa falha, `debug_info.retriable` diz se vale tentar de novo.
 */
export async function enviarVideo(entrada: { containerId: string; token: string; tamanho: number; corpo: ReadableStream<Uint8Array> | Uint8Array }): Promise<void> {
  conferirQueNaoEhRedeDeVerdade();
  const { containerId, token, tamanho, corpo } = entrada;
  let resposta: Response;
  try {
    const init: RequestInit & { duplex?: "half" } = {
      method: "POST",
      headers: {
        authorization: `OAuth ${token}`,
        offset: "0",
        file_size: String(tamanho),
        "content-length": String(tamanho),
        "content-type": "application/octet-stream",
      },
      body: corpo as BodyInit,
      signal: AbortSignal.timeout(60 * 60 * 1000),
    };
    // Um fluxo precisa avisar que o pedido sai antes de a resposta chegar.
    if (!(corpo instanceof Uint8Array)) init.duplex = "half";
    resposta = await fetch(`${enderecoDoRupload()}/${containerId}`, init);
  } catch {
    // Sem a causa: ela pode carregar o endereço.
    throw new ErroDeEnvioDoVideo("Nao foi possivel mandar o video para a Meta (rede, prazo ou envio interrompido).", true);
  }
  type CorpoDoEnvio = { success?: boolean; debug_info?: { retriable?: boolean; message?: string } };
  let json = null as CorpoDoEnvio | null;
  try {
    json = (await resposta.json()) as CorpoDoEnvio;
  } catch {
    json = null;
  }
  if (!resposta.ok || json?.success !== true) {
    // O corpo de erro da Meta leva o motivo; o código da Graph API pode estar dentro de `message` (um JSON em texto).
    throw new ErroDeEnvioDoVideo(`A Meta recusou o envio do video (${resposta.status}).`, json?.debug_info?.retriable === true, codigoDentroDoDebug(json?.debug_info?.message));
  }
}

/** Passo 3: o estado do contêiner (`status_code`). Valor que a documentação não lista vira erro, nunca um palpite. */
export async function statusDoContainer(containerId: string, token: string): Promise<StatusDoContainer> {
  const corpo = await pedirGraph<{ status_code?: unknown }>(containerId, { fields: "status_code" }, token);
  if (typeof corpo.status_code !== "string" || !STATUS_CONHECIDOS.includes(corpo.status_code)) throw new ErroMetaLogin("A Meta devolveu um estado de publicacao desconhecido.");
  return corpo.status_code as StatusDoContainer;
}

/** Passo 4: publica o contêiner pronto. Devolve o id da mídia publicada. */
export async function publicarContainer(entrada: { igId: string; containerId: string; token: string }): Promise<{ midiaId: string }> {
  const corpo = await pedirGraph<{ id?: unknown }>(`${entrada.igId}/media_publish`, { creation_id: entrada.containerId }, entrada.token, "POST");
  if (typeof corpo.id !== "string" || corpo.id === "") throw new ErroMetaLogin("A Meta nao devolveu o id da midia publicada.");
  return { midiaId: corpo.id };
}

/** O endereço da mídia publicada no Instagram; `null` quando a Meta não devolve (uma falha aqui nunca desfaz a publicação). */
export async function enderecoDaMidia(midiaId: string, token: string): Promise<string | null> {
  try {
    const corpo = await pedirGraph<{ permalink?: unknown }>(midiaId, { fields: "permalink" }, token);
    return typeof corpo.permalink === "string" && /^https:\/\//.test(corpo.permalink) ? corpo.permalink : null;
  } catch {
    return null;
  }
}

/** O uso do limite diário: quantas publicações já saíram nas últimas 24 horas e o total permitido (`content_publishing_limit`). */
export async function usoDoLimite(igId: string, token: string): Promise<{ usadas: number; total: number | null }> {
  const corpo = await pedirGraph<{ data?: { quota_usage?: unknown; config?: { quota_total?: unknown } }[] }>(`${igId}/content_publishing_limit`, { fields: "quota_usage,config" }, token);
  const linha = corpo.data?.[0];
  const usadas = typeof linha?.quota_usage === "number" ? linha.quota_usage : 0;
  const total = typeof linha?.config?.quota_total === "number" && linha.config.quota_total > 0 ? linha.config.quota_total : null;
  return { usadas, total };
}
