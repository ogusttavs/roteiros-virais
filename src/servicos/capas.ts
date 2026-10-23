/**
 * A capa do vídeo guardada do nosso lado (hotfix de 22/10/2026).
 *
 * O problema: `videos.capa_url` do Instagram é um link assinado do CDN da Meta e vence em dias (o vídeo 112308, coletado em 01/10, devolvia 403 em 22/10), e a Referência virava um quadro
 * preto só com o play. A saída é baixar a imagem enquanto o link vale e guardá-la em `capas_video` (os bytes do JPEG como vieram, com teto de 300 KB; redimensionar pediria uma biblioteca nova),
 * servida por `/api/capa/<videoId>`. O que venceu antes de ser guardado fica marcado `vencida`, e a tela mostra o embed do Instagram (na tela de um vídeo) ou um quadro neutro (nas listas).
 *
 * Esta parte é a decisão e o download; o job que percorre os vídeos é `jobs/guardar-capas.ts`. TikTok tem o mesmo risco (link de CDN assinado), e passa pelo mesmo caminho: hoje a coleta do
 * TikTok não traz capa (o ator está suspenso, `normalizadores/tiktok.ts`), então não há o que guardar; quando trouxer, o job já cuida. YouTube não entra: a miniatura (`i.ytimg.com`) não vence.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { capasVideo, videos, type Plataforma, type SituacaoDaCapa } from "@/db/schema";

/** O teto do que guardamos por capa. A miniatura de Reel da Meta costuma ter de 40 a 150 KB; passou de 300 KB, fica de fora (o link segue valendo enquanto vale). */
export const TETO_DA_CAPA_BYTES = 300 * 1024;
/** Quantas vezes o job tenta uma capa que falhou por motivo passageiro (rede, 5xx, limite) antes de dá-la por vencida. */
export const TENTATIVAS_ATE_VENCER = 3;
export const TEMPO_LIMITE_DA_CAPA_MS = 8000;

/** Os tipos de imagem que a rota serve. Qualquer outro (HTML de erro com status 200, por exemplo) conta como capa vencida. */
const TIPOS_ACEITOS = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Os CDNs de onde baixamos. O endereço vem do que a plataforma devolveu na coleta, mas o servidor nunca busca um endereço de fora desta lista (um link estranho no banco não vira um pedido
 * a um servidor interno). YouTube fica de fora de propósito: a miniatura não vence.
 */
export const DOMINIOS_DAS_CAPAS = [
  "cdninstagram.com",
  "fbcdn.net",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokv.com",
  "ibyteimg.com",
  "byteoversea.com",
] as const;

/** O mesmo teste, em expressão regular de Postgres, para o job escolher no banco só o que vale a pena tentar. */
export const REGEX_DOS_DOMINIOS_DAS_CAPAS = `^https://([a-z0-9-]+\\.)*(${DOMINIOS_DAS_CAPAS.map((d) => d.replace(/\./g, "\\.")).join("|")})(:[0-9]+)?/`;

export function urlDaCapaGuardada(videoId: number): string {
  return `/api/capa/${videoId}`;
}

/** O endereço é de um CDN de que a gente baixa? (https, e o domínio na lista.) */
export function urlDeCapaBaixavel(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return DOMINIOS_DAS_CAPAS.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Qual capa a tela usa. Guardada: a nossa rota (sempre abre). Vencida: nenhuma (`null`; a tela troca por embed ou quadro neutro, nunca por um `<img>` quebrado). Qualquer outra situação,
 * ou nenhuma linha ainda: o link da plataforma como veio (a miniatura do YouTube, ou a do Instagram nos primeiros dias, quando ainda vale; se falhar no navegador a tela cai no mesmo reserva).
 */
export function escolherCapa(entrada: { videoId: number; capaUrl: string | null; situacao: SituacaoDaCapa | null }): string | null {
  if (entrada.situacao === "guardada") return urlDaCapaGuardada(entrada.videoId);
  if (entrada.situacao === "vencida") return null;
  return entrada.capaUrl;
}

/**
 * O pedaço de SQL que devolve a situação da capa do vídeo (nulo se ainda não há linha), para as consultas que mostram vídeo trazerem junto e passarem por `escolherCapa`.
 * Um subselect, não um join: a consulta de quem usa continua com as mesmas linhas.
 */
export const situacaoDaCapaSql = sql<SituacaoDaCapa | null>`(select ${capasVideo.situacao} from ${capasVideo} where ${capasVideo.videoId} = ${videos.id})`;

export type ResultadoDoDownload =
  | { tipo: "guardada"; contentType: string; bytes: Buffer }
  | { tipo: "vencida" }
  | { tipo: "grande" }
  | { tipo: "passageiro" };

/** O status que o CDN devolve quando o link assinado venceu (ou o post sumiu): não adianta tentar de novo. */
export function statusDeLinkVencido(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 410;
}

/** O tipo sem parâmetros ("image/jpeg; charset=x" vira "image/jpeg"), ou nulo se não for imagem que a gente serve. */
export function tipoDeImagemAceito(contentType: string | null | undefined): string | null {
  const tipo = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return TIPOS_ACEITOS.has(tipo) ? tipo : null;
}

/** Lê o corpo até o teto; passou dele, para de ler e avisa (nunca carrega uma imagem enorme na memória). */
async function lerAteOTeto(resposta: Response, teto: number): Promise<Buffer | "grande"> {
  const declarado = Number(resposta.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > teto) {
    await resposta.body?.cancel().catch(() => undefined);
    return "grande";
  }
  if (!resposta.body) return Buffer.alloc(0);
  const leitor = resposta.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel().catch(() => undefined);
      return "grande";
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}

/** Baixa a capa de um link. `buscar` é obrigatório de propósito: em produção é o `buscarComAgenteSeguro` (guarda de DNS, `jobs/busca-segura.ts`), nunca o `fetch` global. Nunca lança: o que deu errado vira um dos quatro resultados, e o job decide o que gravar. */
export async function baixarCapa(url: string, buscar: typeof fetch, teto: number = TETO_DA_CAPA_BYTES): Promise<ResultadoDoDownload> {
  if (!urlDeCapaBaixavel(url)) return { tipo: "vencida" };
  try {
    const resposta = await buscar(url, { redirect: "manual", signal: AbortSignal.timeout(TEMPO_LIMITE_DA_CAPA_MS), headers: { accept: "image/*" } });
    if (statusDeLinkVencido(resposta.status)) {
      await resposta.body?.cancel().catch(() => undefined);
      return { tipo: "vencida" };
    }
    if (!resposta.ok) {
      await resposta.body?.cancel().catch(() => undefined);
      return { tipo: "passageiro" };
    }
    const contentType = tipoDeImagemAceito(resposta.headers.get("content-type"));
    if (!contentType) {
      await resposta.body?.cancel().catch(() => undefined);
      return { tipo: "vencida" };
    }
    const bytes = await lerAteOTeto(resposta, teto);
    if (bytes === "grande") return { tipo: "grande" };
    if (bytes.length === 0) return { tipo: "vencida" };
    return { tipo: "guardada", contentType, bytes };
  } catch {
    return { tipo: "passageiro" };
  }
}

/**
 * Grava o resultado de uma tentativa. `passageiro` não decide nada: conta a tentativa e deixa `tentando`; na terceira (`TENTATIVAS_ATE_VENCER`) vira `vencida`. Um link novo
 * (outra `urlTentada`) zera a conta. Devolve a situação que ficou.
 */
export async function gravarResultadoDaCapa(videoId: number, url: string, resultado: ResultadoDoDownload): Promise<SituacaoDaCapa> {
  const [anterior] = await db().select({ tentativas: capasVideo.tentativas, urlTentada: capasVideo.urlTentada }).from(capasVideo).where(eq(capasVideo.videoId, videoId));
  const mesmoLink = anterior?.urlTentada === url;
  const tentativas = resultado.tipo === "passageiro" ? (mesmoLink ? anterior.tentativas : 0) + 1 : (mesmoLink ? anterior.tentativas : 0);
  const situacao: SituacaoDaCapa =
    resultado.tipo === "guardada" ? "guardada" : resultado.tipo === "grande" ? "grande" : resultado.tipo === "vencida" ? "vencida" : tentativas >= TENTATIVAS_ATE_VENCER ? "vencida" : "tentando";
  const valores = {
    situacao,
    tipo: resultado.tipo === "guardada" ? resultado.contentType : null,
    bytes: resultado.tipo === "guardada" ? resultado.bytes : null,
    urlTentada: url,
    tentativas,
    atualizadoEm: new Date(),
  };
  await db()
    .insert(capasVideo)
    .values({ videoId, ...valores })
    .onConflictDoUpdate({ target: capasVideo.videoId, set: valores });
  return situacao;
}

export type CapaGuardada = { tipo: string; bytes: Buffer; atualizadoEm: Date };

export async function lerCapaGuardada(videoId: number): Promise<CapaGuardada | null> {
  const [linha] = await db()
    .select({ tipo: capasVideo.tipo, bytes: capasVideo.bytes, atualizadoEm: capasVideo.atualizadoEm })
    .from(capasVideo)
    .where(and(eq(capasVideo.videoId, videoId), eq(capasVideo.situacao, "guardada")));
  if (!linha || !linha.tipo || !linha.bytes) return null;
  return { tipo: linha.tipo, bytes: linha.bytes, atualizadoEm: linha.atualizadoEm };
}

/**
 * Os vídeos que o job ainda precisa tentar, do mais novo ao mais velho (o link novo é o que ainda vale): sem linha nenhuma; ou `tentando`; ou com um link diferente do que foi tentado
 * (recoleta trouxe link novo), qualquer que tenha sido o resultado da vez anterior, menos `guardada` (a imagem que a gente tem não vence). Só links dos CDNs de `DOMINIOS_DAS_CAPAS`.
 */
export async function videosComCapaPorGuardar(limite: number, plataforma?: Plataforma): Promise<{ id: number; capaUrl: string }[]> {
  const linhas = await db()
    .select({ id: videos.id, capaUrl: videos.capaUrl })
    .from(videos)
    .leftJoin(capasVideo, eq(capasVideo.videoId, videos.id))
    .where(
      and(
        sql`${videos.capaUrl} ~ ${REGEX_DOS_DOMINIOS_DAS_CAPAS}`,
        plataforma ? eq(videos.plataforma, plataforma) : undefined,
        or(
          isNull(capasVideo.videoId),
          and(sql`${capasVideo.situacao} <> 'guardada'`, or(eq(capasVideo.situacao, "tentando"), sql`${capasVideo.urlTentada} is distinct from ${videos.capaUrl}`)),
        ),
      ),
    )
    .orderBy(sql`${videos.id} desc`)
    .limit(limite);
  return linhas.filter((l): l is { id: number; capaUrl: string } => l.capaUrl !== null);
}
