/**
 * Legenda oficial do YouTube via yt-dlp (etapa 8): a API oficial do YouTube
 * so devolve legenda de terceiro com OAuth do dono do canal
 * (`captions.download`), inviavel para video de outra conta; yt-dlp baixa a
 * legenda automatica publica sem autenticacao nenhuma. Sem custo, tentada
 * antes de baixar audio e gastar credito da Groq.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "@/lib/config";

import { apagarSobrasDoDownload, type ExecutorDeProcesso, ErroTempoLimite, executarComLimite } from "./processo";
import { argumentosYoutube } from "./youtube-cliente";

/**
 * O `yt-dlp` passou do tempo limite por vídeo (M5c) e foi morto, buscando a legenda. Diferente de "sem legenda" (que é
 * `null`, comum e sem erro): quem chama NÃO tenta o áudio em seguida (é o mesmo proxy, o mesmo YouTube, e o áudio
 * penduraria pelo mesmo motivo, dobrando o tempo perdido neste vídeo).
 */
export class ErroLegendaTempoLimite extends Error {}

const ENTIDADES_HTML: Record<string, string> = {
  "&gt;": ">",
  "&lt;": "<",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * A legenda automatica do YouTube vem com entidades HTML (achado rodando
 * com chave real: "&gt;&gt;" aparecendo literal na transcricao gravada).
 */
function decodificarEntidadesHtml(texto: string): string {
  return texto.replace(/&(gt|lt|amp|quot|#39|nbsp);/g, (entidade) => ENTIDADES_HTML[entidade] ?? entidade);
}

/**
 * Um bloco WEBVTT e "HH:MM:SS.mmm --> HH:MM:SS.mmm\ntexto"; junta so o texto,
 * pulando cabecalho, timestamp e linha vazia. Pura, sem tocar disco nem
 * processo, para testar sem yt-dlp instalado.
 */
export function interpretarVtt(conteudo: string): string {
  const linhas = conteudo.split("\n");
  const partes: string[] = [];

  for (const linhaBruta of linhas) {
    const linha = linhaBruta.trim();
    if (!linha) continue;
    if (linha.startsWith("WEBVTT") || linha.startsWith("Kind:") || linha.startsWith("Language:")) continue;
    if (linha.includes("-->")) continue;
    if (/^\d+$/.test(linha)) continue; // indice de cue, quando existe

    const semTags = linha.replace(/<[^>]+>/g, "");
    partes.push(decodificarEntidadesHtml(semTags));
  }

  // A legenda automatica do YouTube as vezes repete a mesma linha em cues
  // consecutivos (efeito "rolagem"); remove repeticao direta consecutiva.
  const semRepeticao = partes.filter((parte, i) => parte !== partes[i - 1]);

  return semRepeticao.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Baixa a legenda automatica no idioma pedido e devolve o texto puro, ou
 * null se o video nao tiver legenda nesse idioma (comum, nao e erro). Apaga
 * o arquivo temporario sempre, mesmo em erro.
 *
 * Achado 3 da revisao do motor (01/10/2026): `idioma` nao tem mais valor
 * padrao. Antes, "pt" fixo pedia ao YouTube a faixa traduzida para
 * portugues em todo video de outro idioma (o `--sub-lang` do yt-dlp busca a
 * legenda NESSE idioma, traduzida quando preciso, nunca a original); quem
 * chama agora so pede quando ja sabe o idioma de verdade do video
 * (`videos.idioma`), pedindo a faixa original, nao a traducao.
 */
export async function baixarLegendaYoutube(
  url: string,
  idioma: "pt" | "en" | "es",
  /** Só para o teste: o limite e o processo. Sem isto, `config.transcricao.ytdlpLimiteS` e o `yt-dlp` de verdade. */
  opcoes: { limiteMs?: number; executar?: ExecutorDeProcesso } = {},
): Promise<string | null> {
  const pasta = tmpdir();
  const prefixo = `legenda-${randomUUID()}`;
  const caminhoEsperado = join(pasta, `${prefixo}.${idioma}.vtt`);
  const limiteMs = opcoes.limiteMs ?? config.transcricao.ytdlpLimiteS * 1000;

  try {
    try {
      await executarComLimite(
        "yt-dlp",
        [
          "--write-auto-sub",
          "--sub-lang",
          idioma,
          "--skip-download",
          "--sub-format",
          "vtt",
          ...argumentosYoutube(),
          "-o",
          join(pasta, `${prefixo}.%(ext)s`),
          url,
        ],
        limiteMs,
        opcoes.executar,
      );
    } catch (erro) {
      if (erro instanceof ErroTempoLimite) {
        throw new ErroLegendaTempoLimite(`o yt-dlp passou de ${Math.round(limiteMs / 1000)} s buscando a legenda de ${url} (tempo limite por video)`);
      }
      return null;
    }

    const conteudo = await readFile(caminhoEsperado, "utf8").catch(() => null);
    if (!conteudo) return null;

    const texto = interpretarVtt(conteudo);
    return texto || null;
  } finally {
    // O arquivo esperado e o que um `yt-dlp` morto pelo limite deixou pela metade (mesmo prefixo).
    await apagarSobrasDoDownload(pasta, prefixo);
  }
}
