/**
 * Legenda oficial do YouTube via yt-dlp (etapa 8): a API oficial do YouTube
 * so devolve legenda de terceiro com OAuth do dono do canal
 * (`captions.download`), inviavel para video de outra conta; yt-dlp baixa a
 * legenda automatica publica sem autenticacao nenhuma. Sem custo, tentada
 * antes de baixar audio e gastar credito da Groq.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
 * Baixa a legenda automatica em portugues e devolve o texto puro, ou null
 * se o video nao tiver legenda nesse idioma (comum, nao e erro). Apaga o
 * arquivo temporario sempre, mesmo em erro.
 */
export async function baixarLegendaYoutube(url: string, idioma = "pt"): Promise<string | null> {
  const pasta = tmpdir();
  const prefixo = `legenda-${randomUUID()}`;
  const caminhoEsperado = join(pasta, `${prefixo}.${idioma}.vtt`);

  try {
    await execFileAsync("yt-dlp", [
      "--write-auto-sub",
      "--sub-lang",
      idioma,
      "--skip-download",
      "--sub-format",
      "vtt",
      "-o",
      join(pasta, `${prefixo}.%(ext)s`),
      url,
    ]);

    const conteudo = await readFile(caminhoEsperado, "utf8").catch(() => null);
    if (!conteudo) return null;

    const texto = interpretarVtt(conteudo);
    return texto || null;
  } catch {
    return null;
  } finally {
    await rm(caminhoEsperado, { force: true }).catch(() => undefined);
  }
}
