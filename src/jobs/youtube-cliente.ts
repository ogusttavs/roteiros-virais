import { config } from "@/lib/config";

/**
 * Cliente de player do yt-dlp para o YouTube (transcrição do YouTube,
 * rodada 2, item 1, 10/09/2026): a rodada 1 (09/09) escolheu "web_embedded"
 * porque ele não precisa de PO Token nem de cookie; a prova em produção de
 * `a31103a` (10/09, 11:38 UTC) mostrou 30 de 30 vídeos bloqueados com "Sign
 * in to confirm you're not a bot" mesmo assim, o bloqueio de IP de
 * datacenter continua com esse cliente. Muda para o provedor de PO Token.
 *
 * Fontes conferidas em 10/09/2026 (nunca de memória, as duas mudam):
 * - Wiki "PO-Token-Guide" do yt-dlp: só "android_vr" e "web_embedded" não
 *   precisam de PO Token de jeito nenhum hoje; "recommended setup: Use a PO
 *   Token Provider plugin to provide the mweb client with a PO Token for
 *   GVS requests" ("mweb" só precisa de token para o vídeo, GVS, não para a
 *   legenda). "android"/"android_vr"/"ios" não funcionam com um provedor
 *   local (usam DroidGuard/iOSGuard, não o Web BotGuard que o provedor
 *   imita).
 * - README do `bgutil-ytdlp-pot-provider` (tag `2.0.0`, publicada em
 *   08/09/2026, `deploy/Dockerfile.worker` e `deploy/compose.prod.yml`
 *   fixam essa versão): exige yt-dlp 2025.05.22 ou mais novo (a versão
 *   fixada aqui, bem mais nova); o servidor HTTP do provedor escuta em
 *   `4416` por padrão; o plugin lê o argumento
 *   `youtubepot-bgutilhttp:base_url=<url>` para achar o servidor (sem isso,
 *   tenta `http://127.0.0.1:4416`, que não existe daqui, o worker e o
 *   provedor são containers separados); README do próprio yt-dlp,
 *   "Installing Plugins": um executável standalone (o zipapp deste projeto,
 *   `deploy/Dockerfile.worker`) procura plugin em
 *   `<pasta do yt-dlp>/yt-dlp-plugins/`, e um `.zip` com `yt_dlp_plugins/`
 *   na raiz (conferido: é a estrutura do release deste provedor) entra
 *   direto ali, sem descompactar.
 *
 * `--extractor-args` repetido, um por extrator (`youtube:` para o cliente,
 * `youtubepot-bgutilhttp:` para o endereço do provedor): a wiki do próprio
 * yt-dlp, seção "EXTRACTOR ARGUMENTS", mostra exatamente esse formato
 * (`--extractor-args "youtube:..." --extractor-args "twitter:..."`).
 *
 * `--sleep-requests 2` (item 2 desta rodada, subiu de 1): um pouco mais de
 * espaço entre as chamadas que o próprio yt-dlp faz por dentro (paginação
 * de formatos, manifestos), para além da pausa entre vídeos inteiros que
 * `pausaEntreVideosYoutube` (abaixo) cuida em `transcrever.ts` e
 * `analisar-visual.ts`.
 */
export function argumentosYoutube(): string[] {
  return [
    "--extractor-args",
    "youtube:player_client=mweb",
    "--extractor-args",
    `youtubepot-bgutilhttp:base_url=${config.transcricao.potBaseUrl}`,
    "--sleep-requests",
    "2",
  ];
}

/**
 * Pausa entre um vídeo do YouTube e o seguinte (item 2 desta rodada):
 * `transcrever.ts` e `analisar-visual.ts` chamam depois de processar cada
 * vídeo do YouTube (qualquer resultado, sucesso ou falha), antes de seguir
 * para o próximo. `esperar` injetável (mesmo padrão de `aguardarJanela` em
 * `meta-api.ts`, "relógio falso" sem mockar temporizador global, que
 * quebraria o pool do Postgres): o teste passa uma função que só registra
 * quanto tempo pediu, sem esperar de verdade.
 */
export async function pausaEntreVideosYoutube(
  esperar: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  await esperar(config.transcricao.youtubePausaS * 1000);
}

const HOSTS_YOUTUBE = ["youtube.com", "youtu.be"];

/** `audio.ts` baixa das três plataformas com a mesma função; só o YouTube ganha `argumentosYoutube()`. */
export function ehUrlDoYoutube(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return HOSTS_YOUTUBE.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
