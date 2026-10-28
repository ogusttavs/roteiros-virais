/**
 * Ler UM vídeo do TikTok por URL pelo `yt-dlp` (27/10/2026, estudo `pesquisa/estudo-tiktok-sem-apify.md`): a curva do cliente deixa de gastar a Apify
 * (US$ 1,70 por mil resultados) para reler o vídeo que a pessoa postou. O estudo mediu 4 de 4 leituras certas, de 2,7 a 4 s e uns 90 KB de tráfego cada.
 *
 * O que NÃO muda: a descoberta de vídeos por perfil e por hashtag continua na Apify (`apify-api.ts`). Pelo `yt-dlp` a listagem de perfil acertou 1 vez em 24
 * e a hashtag não existe; este módulo só lê um vídeo cujo endereço já se conhece.
 *
 * O resultado sai no mesmo formato que a Apify devolve (`TiktokItemBruto`), para quem consome (a curva, o normalizador) não saber de onde veio.
 * Seguidores do autor não vêm pela página do vídeo (`channel_follower_count` veio nulo nos quatro testes): o item sai sem `authorMeta.fans`, o normalizador
 * devolve `seguidores: null` e a gravação da conta (`coleta-comum.ts`, `coalesce`) mantém o último valor conhecido.
 *
 * Os argumentos montam do mesmo jeito que o YouTube (`youtube-cliente.ts`): o proxy de `YTDLP_PROXY` (`argumentosProxy`). O processo roda com tempo limite e é
 * MORTO ao passar dele (`processo.ts`). Nenhuma mensagem de erro leva a linha de comando: ela repete `--proxy http://usuario:senha@host`.
 */
import { config } from "@/lib/config";

import type { TiktokItemBruto } from "./apify-api";
import { ErroTempoLimite, executarComLimite, type ExecutorDeProcesso } from "./processo";
import { argumentosProxy, motivoDaFalhaDoProxy } from "./youtube-cliente";

/** Pausa entre uma leitura e a seguinte, em ms: o estudo pede de 3 a 6 s, sempre em fila, nunca em paralelo, para não marcar o IP de casa. */
export const PAUSA_MIN_MS = 3_000;
export const PAUSA_MAX_MS = 6_000;

/** Quantas leituras seguidas podem falhar antes de a rodada parar de insistir no `yt-dlp` e ficar só com a reserva. */
export const FALHAS_SEGUIDAS_PARA_PARAR = 3;

export type MotivoDaFalhaYtdlp = "tempo limite" | "proxy" | "bloqueio" | "falhou";

/**
 * O `yt-dlp` não conseguiu ler o vídeo (e não foi porque o vídeo sumiu: esse caso volta `null`, sem erro). `bloqueio` e `proxy` valem para a rodada inteira, não
 * só para este vídeo: quem chama para de usar o `yt-dlp` pelo resto dela (o estudo: ao primeiro `TCP_DENIED` ou desafio não resolvido, sem insistir).
 */
export class ErroYtdlpTiktok extends Error {
  constructor(
    readonly motivo: MotivoDaFalhaYtdlp,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroYtdlpTiktok";
  }
}

/** O motivo vale para a rodada inteira (todo vídeo seguinte falharia do mesmo jeito)? */
export function motivoParaTodaARodada(motivo: MotivoDaFalhaYtdlp): boolean {
  return motivo === "bloqueio" || motivo === "proxy";
}

/** Os argumentos do `yt-dlp` para ler um vídeo sem baixá-lo: o JSON inteiro na saída, o proxy do TikTok (o do YouTube, sem o cliente de player). */
export function argumentosLeituraTiktok(url: string): string[] {
  return ["--skip-download", "--dump-json", "--no-playlist", "--no-warnings", ...argumentosProxy(), url];
}

// O vídeo em si não existe mais ou não é público: não é falha do `yt-dlp` nem do proxy, e a Apify também não o acharia (gastaria um resultado à toa).
const VIDEO_INDISPONIVEL =
  /Video not available|video (?:has been|was) removed|This post may not be comfortable|private (?:video|account)|This video is private|Status code 10204|Status code 10216|HTTP Error 404/i;
// O firewall (Akamai, Slardar) respondeu com a página de desafio ou de manutenção no lugar do vídeo, ou o `yt-dlp` não conseguiu ler o que veio.
const BLOQUEIO =
  /TCP_DENIED|AkamaiGHost|Slardar|Site Maintenance|Failed to parse JSON|Expecting value|JS challenge|challenge|Unable to extract|IP address is blocked|blocked/i;

function linhasDeErro(texto: string): string {
  const linhas = texto.split(/\r?\n/).filter((linha) => linha.trim().startsWith("ERROR:"));
  return linhas.length > 0 ? linhas.join("\n") : texto;
}

/** O texto do erro do processo (stderr e mensagem) sem o que identifica a linha de comando. */
function textoDoErro(erro: unknown): string {
  if (typeof erro !== "object" || erro === null) return String(erro);
  const { stderr, message } = erro as { stderr?: unknown; message?: unknown };
  return [typeof stderr === "string" ? stderr : "", typeof message === "string" ? message : ""].join("\n");
}

/** Um número finito ou `undefined` (o JSON do `yt-dlp` traz `null` para o que o TikTok não deu). */
function numero(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() !== "" ? valor : undefined;
}

/** `timestamp` (segundos, hora exata) primeiro; sem ele, `upload_date` ("AAAAMMDD") à meia-noite UTC. */
function dataISO(json: Record<string, unknown>): string | undefined {
  const segundos = numero(json.timestamp);
  if (segundos !== undefined) return new Date(segundos * 1000).toISOString();
  const dia = texto(json.upload_date);
  const partes = dia ? /^(\d{4})(\d{2})(\d{2})$/.exec(dia) : null;
  return partes ? `${partes[1]}-${partes[2]}-${partes[3]}T00:00:00.000Z` : undefined;
}

/**
 * O JSON de `yt-dlp --dump-json` de um vídeo do TikTok no formato do item da Apify. Pura, sem rede.
 *
 * - `uploader` é o @ da conta (`authorMeta.name`), `channel` o nome de exibição (`authorMeta.nickName`).
 * - `track` e `artists` são o nome e o autor da música; o id da música e se ela é original NÃO vêm (ficam de fora, nunca inventados).
 * - Os dois campos novos que a Apify não trazia (`repost_count`, `save_count`) vão em `shareCount` e `collectCount`, os nomes do ator.
 * - Devolve `null` sem `id` ou sem o @ de onde postou: o item não serve nem para a curva nem para o normalizador.
 */
export function itemTiktokDoYtdlp(json: unknown, urlPedida: string): TiktokItemBruto | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const j = json as Record<string, unknown>;
  const id = texto(j.id) ?? (numero(j.id) !== undefined ? String(j.id) : undefined) ?? texto(j.display_id);
  const handle = texto(j.uploader);
  if (!id || !handle) return null;

  const legenda = texto(j.description) ?? texto(j.title);
  const musica = texto(j.track);
  const autorDaMusica = Array.isArray(j.artists) ? (j.artists as unknown[]).filter((a): a is string => typeof a === "string").join(", ") : texto(j.artist);

  const item: TiktokItemBruto & { shareCount?: number; collectCount?: number } = {
    id,
    webVideoUrl: texto(j.webpage_url) ?? urlPedida,
    text: legenda,
    createTimeISO: dataISO(j),
    authorMeta: { name: handle, nickName: texto(j.channel) },
    videoMeta: { duration: numero(j.duration) },
    playCount: numero(j.view_count),
    diggCount: numero(j.like_count),
    commentCount: numero(j.comment_count),
    shareCount: numero(j.repost_count),
    collectCount: numero(j.save_count),
  };
  const seguidores = numero(j.channel_follower_count);
  if (seguidores !== undefined) item.authorMeta!.fans = seguidores;
  if (musica || autorDaMusica) item.musicMeta = { musicName: musica, musicAuthor: autorDaMusica || undefined };
  return item;
}

/** A última linha de JSON da saída (o `--dump-json` de um vídeo só imprime uma; qualquer aviso antes dela é ignorado). */
function interpretarSaida(stdout: string): unknown {
  const linhas = stdout.split(/\r?\n/).filter((linha) => linha.trim() !== "");
  const ultima = linhas[linhas.length - 1] ?? "";
  try {
    return JSON.parse(ultima);
  } catch {
    throw new ErroYtdlpTiktok("bloqueio", "o yt-dlp não devolveu o JSON do vídeo (página do firewall no lugar dele)");
  }
}

/**
 * Lê o vídeo pela URL. `null` quando o vídeo não existe mais ou não é público. Falha do `yt-dlp` vira `ErroYtdlpTiktok` com o motivo
 * (tempo limite, proxy, bloqueio ou outra), para quem chama decidir entre a reserva e parar a rodada.
 */
export async function lerTiktokPorYtdlp(
  url: string,
  /** Só para o teste: o limite e o processo. Sem isto, `config.transcricao.tiktokYtdlpLimiteS` e o `yt-dlp` de verdade. */
  opcoes: { limiteMs?: number; executar?: ExecutorDeProcesso } = {},
): Promise<TiktokItemBruto | null> {
  const limiteMs = opcoes.limiteMs ?? config.transcricao.tiktokYtdlpLimiteS * 1000;
  let saida: { stdout: string; stderr: string };
  try {
    saida = await executarComLimite("yt-dlp", argumentosLeituraTiktok(url), limiteMs, opcoes.executar);
  } catch (erro) {
    if (erro instanceof ErroTempoLimite) {
      throw new ErroYtdlpTiktok("tempo limite", `o yt-dlp passou de ${Math.round(limiteMs / 1000)} s lendo o vídeo (tempo limite)`);
    }
    const relato = linhasDeErro(textoDoErro(erro));
    const motivoDoProxy = motivoDaFalhaDoProxy(relato);
    if (motivoDoProxy) throw new ErroYtdlpTiktok("proxy", `${motivoDoProxy}: a leitura do vídeo passou pelo proxy e ele não serviu`);
    if (VIDEO_INDISPONIVEL.test(relato)) return null;
    if (BLOQUEIO.test(relato)) throw new ErroYtdlpTiktok("bloqueio", "o TikTok barrou a leitura (firewall ou desafio não resolvido)");
    throw new ErroYtdlpTiktok("falhou", "o yt-dlp não leu o vídeo");
  }

  const item = itemTiktokDoYtdlp(interpretarSaida(saida.stdout), url);
  if (!item) throw new ErroYtdlpTiktok("falhou", "o JSON do yt-dlp veio sem o id ou sem a conta do vídeo");
  return item;
}

/** Uma pausa aleatória entre `PAUSA_MIN_MS` e `PAUSA_MAX_MS`; `esperar` injetável para o teste não esperar de verdade. */
export async function pausaEntreLeiturasTiktok(
  esperar: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  sorteio: () => number = Math.random,
): Promise<void> {
  await esperar(Math.round(PAUSA_MIN_MS + sorteio() * (PAUSA_MAX_MS - PAUSA_MIN_MS)));
}
