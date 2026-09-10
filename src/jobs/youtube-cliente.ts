/**
 * Cliente de player do yt-dlp para o YouTube (achado da conferência de
 * produção, 09/09/2026): o worker roda num IP de datacenter da Hostinger,
 * sem cookie de conta nem proxy residencial (decisão do Gustavo: os dois
 * ficam de fora sem ele pedir, `PROXIMO.md`). A wiki do yt-dlp, conferida
 * em 09/09/2026 ("EJS" e "PO-Token-Guide", nunca de memória, ela muda),
 * diz duas coisas separadas:
 *
 * (1) o desafio de assinatura da página exige um runtime de JavaScript; o
 *     Deno (instalado em `deploy/Dockerfile.worker`) é habilitado sozinho
 *     pelo yt-dlp, sem flag nenhuma, a partir da versão 2.3.0 dele.
 * (2) o cliente de player padrão ("web") exige PO Token para o vídeo e,
 *     para a legenda, cookie de conta; o cliente "web_embedded" não exige
 *     nenhum dos dois (a wiki lista "Not required" para ele nas duas
 *     colunas). Por isso o item 3 desta rodada (um provedor de PO Token)
 *     não entrou: o cliente escolhido não precisa de token.
 *
 * `--sleep-requests 1`: um segundo entre as chamadas que o próprio yt-dlp
 * faz por dentro (paginação de formatos, manifestos), pequeno o bastante
 * para não atrasar a transcrição, só para não parecer uma rajada.
 */
export function argumentosYoutube(): string[] {
  return ["--extractor-args", "youtube:player_client=web_embedded", "--sleep-requests", "1"];
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
