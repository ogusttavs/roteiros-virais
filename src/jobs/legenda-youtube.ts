/**
 * A legenda do próprio YouTube antes do áudio (`TRANSCRICAO_LEGENDA_PRIMEIRO`, ligada por padrão): o `yt-dlp` pede a legenda manual e a automática
 * em json3, sem baixar o vídeo, e, se ela traz texto suficiente para a duração, vira a transcrição (o mesmo texto puro que a Groq devolve, em
 * `videos.transcricao`). Sem legenda ou curta demais, quem chama segue para o áudio e a Groq, como sempre.
 *
 * Diferença para `legendas-youtube.ts` (vtt, só a automática, só quando o idioma já é conhecido): aqui entram também as legendas manuais (melhores),
 * em json3 (que traz o texto por trecho, sem as marcas de tempo dentro da linha), e o idioma é conferido contra o que o vídeo diz ser.
 */
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "@/lib/config";

import { ErroLegendaDoProxy, ErroLegendaTempoLimite } from "./legendas-youtube";
import { apagarSobrasDoDownload, ErroTempoLimite, type ExecutorDeProcesso, executarComLimite } from "./processo";
import { argumentosYoutube, motivoDaFalhaDoProxy } from "./youtube-cliente";

export type FonteDaLegenda = "legenda-manual" | "legenda-automatica";

export type LegendaTranscrita = { texto: string; fonte: FonteDaLegenda };

type SegmentoJson3 = { utf8?: string; tOffsetMs?: number; acAsrConf?: number };
type EventoJson3 = { segs?: SegmentoJson3[] };

/** Sem a duração (ou 0), o piso é o mesmo de sempre da legenda do YouTube: 200 caracteres. */
const PISO_SEM_DURACAO = 200;
/** Com a duração: uns 5 caracteres por segundo (cerca de uma palavra por segundo, bem abaixo de uma fala normal), nunca menos que 80. */
const CARACTERES_POR_SEGUNDO = 5;
const PISO_MINIMO = 80;

/** Quantos caracteres a legenda precisa ter para valer como a fala do vídeo. Pura, para o teste e para quem chama. */
export function tamanhoMinimoDaLegenda(duracaoSegundos: number | null | undefined): number {
  if (!duracaoSegundos || duracaoSegundos <= 0) return PISO_SEM_DURACAO;
  return Math.max(PISO_MINIMO, Math.round(duracaoSegundos * CARACTERES_POR_SEGUNDO));
}

const ENTIDADES: Record<string, string> = { "&gt;": ">", "&lt;": "<", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function limparTrecho(bruto: string): string {
  return bruto
    .replace(/&(gt|lt|amp|quot|#39|nbsp);/g, (e) => ENTIDADES[e] ?? e)
    .replace(/\[[^\]]{0,40}\]/g, " ") // [Música], [Aplausos], [Music]: marcação de som, não é fala
    .replace(/[♪♫]+/g, " ")
    .replace(/(^|\s)>>+/g, " ") // troca de quem fala
    .replace(/\s+/g, " ")
    .trim();
}

function palavras(texto: string): string[] {
  return texto.split(" ").filter(Boolean);
}

/**
 * Junta o trecho novo ao que já está. A legenda automática repete linhas (a rolagem: a linha de cima sobe e volta no evento seguinte, com
 * mais palavras): trecho igual, contido no que já está, ou que continua o anterior repetindo o começo, não entra em dobro.
 */
function acrescentar(atual: string[], trecho: string): void {
  const novas = palavras(trecho);
  if (novas.length === 0) return;
  const cauda = atual.slice(-60);
  const juntoDaCauda = ` ${cauda.join(" ")} `;
  // Já dito inteiro logo antes (linha repetida): ignora.
  if (juntoDaCauda.includes(` ${novas.join(" ")} `)) return;
  // A sobreposição: o fim do que já está é o começo do trecho novo (mínimo de 2 palavras, para "não não" legítimo não sumir).
  const maximo = Math.min(cauda.length, novas.length);
  for (let k = maximo; k >= 2; k--) {
    if (cauda.slice(-k).join(" ") === novas.slice(0, k).join(" ")) {
      atual.push(...novas.slice(k));
      return;
    }
  }
  atual.push(...novas);
}

/**
 * O texto puro de uma legenda json3 do YouTube, e de que tipo ela é; `null` quando não há texto suficiente para a duração do vídeo (então quem
 * chama usa o áudio). Pura: sem disco nem processo. A automática é a que traz `acAsrConf` ou `tOffsetMs` (reconhecimento de fala, palavra a palavra).
 */
export function transcricaoDaLegenda(json3: string, duracaoSegundos: number | null | undefined): LegendaTranscrita | null {
  let eventos: EventoJson3[];
  try {
    const lido = JSON.parse(json3) as { events?: EventoJson3[] };
    eventos = Array.isArray(lido.events) ? lido.events : [];
  } catch {
    return null;
  }

  let automatica = false;
  const dito: string[] = [];
  for (const evento of eventos) {
    if (!Array.isArray(evento.segs)) continue;
    let bruto = "";
    for (const seg of evento.segs) {
      if (seg.acAsrConf !== undefined || seg.tOffsetMs !== undefined) automatica = true;
      bruto += seg.utf8 ?? "";
    }
    const trecho = limparTrecho(bruto);
    if (trecho) acrescentar(dito, trecho);
  }

  const texto = dito.join(" ").trim();
  if (texto.length < tamanhoMinimoDaLegenda(duracaoSegundos)) return null;
  return { texto, fonte: automatica ? "legenda-automatica" : "legenda-manual" };
}

/** Os argumentos do `yt-dlp` para só a legenda (manual e automática), em json3. Pura, para testar sem abrir processo. */
export function argumentosDeLegendaJson3(url: string, modeloDeSaida: string): string[] {
  return [
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    "pt.*,pt,en.*",
    "--sub-format",
    "json3",
    // Mesmo cliente e mesmo proxy do áudio do YouTube.
    ...argumentosYoutube(),
    "-o",
    modeloDeSaida,
    url,
  ];
}

/** O idioma ("pt", "en") de um arquivo `<prefixo>.<lang>.json3`, e se é a faixa original da fala (`-orig`). */
function idiomaDoArquivo(nome: string, prefixo: string): { lang: string; original: boolean } | null {
  const m = nome.slice(prefixo.length).match(/^\.([A-Za-z0-9-]+)\.json3$/);
  if (!m) return null;
  const lang = m[1].toLowerCase();
  return { lang, original: lang.endsWith("-orig") };
}

/**
 * A faixa do YouTube vale como a fala do vídeo? O YouTube oferece a tradução automática de qualquer faixa para pt e en (o achado 3 da revisão do motor,
 * 01/10/2026): um vídeo em inglês "tem" legenda em pt, traduzida, que não é o que a pessoa disse. Idioma conhecido: só a faixa desse idioma. Idioma desconhecido:
 * só a faixa marcada como original (`-orig`) ou a manual (sem as marcas do reconhecimento de fala).
 */
function faixaServe(lang: string, original: boolean, fonte: FonteDaLegenda, idiomaConhecido: string | null | undefined): boolean {
  const base = lang.split("-")[0];
  if (idiomaConhecido === "pt" || idiomaConhecido === "en") return base === idiomaConhecido;
  // Idioma conhecido que a busca não cobre (es, outro): nenhuma faixa de pt ou en é a fala dele.
  if (idiomaConhecido) return false;
  return original || fonte === "legenda-manual";
}

/**
 * Baixa a legenda do YouTube em json3 e devolve o texto limpo, ou `null` (sem legenda, curta demais, faixa que não é a fala, falha comum do `yt-dlp`).
 * Tempo limite e proxy recusando lançam os mesmos erros de `legendas-youtube.ts`: quem chama não tenta o áudio, que passaria pelo mesmo caminho.
 */
export async function baixarLegendaJson3(
  url: string,
  duracaoSegundos: number | null | undefined,
  idiomaConhecido: string | null | undefined,
  /** Só para o teste: o limite e o processo. Sem isto, `config.transcricao.ytdlpLimiteS` e o `yt-dlp` de verdade. */
  opcoes: { limiteMs?: number; executar?: ExecutorDeProcesso } = {},
): Promise<(LegendaTranscrita & { idioma: string }) | null> {
  const pasta = tmpdir();
  const prefixo = `legenda-${randomUUID()}`;
  const limiteMs = opcoes.limiteMs ?? config.transcricao.ytdlpLimiteS * 1000;

  try {
    try {
      await executarComLimite("yt-dlp", argumentosDeLegendaJson3(url, join(pasta, `${prefixo}.%(ext)s`)), limiteMs, opcoes.executar);
    } catch (erro) {
      if (erro instanceof ErroTempoLimite) {
        throw new ErroLegendaTempoLimite(`o yt-dlp passou de ${Math.round(limiteMs / 1000)} s buscando a legenda de ${url} (tempo limite por video)`);
      }
      const motivoDoProxy = motivoDaFalhaDoProxy(String(erro));
      if (motivoDoProxy) throw new ErroLegendaDoProxy(motivoDoProxy, `${motivoDoProxy}: a legenda de ${url} passou pelo proxy e ele recusou`);
      return null;
    }

    const arquivos = (await readdir(pasta).catch(() => [] as string[])).filter((n) => n.startsWith(prefixo));
    // Candidatas por ordem: a manual antes da automática, o pt antes do en, a original antes da traduzida.
    const candidatas: { legenda: LegendaTranscrita; lang: string; ordem: number }[] = [];
    for (const nome of arquivos) {
      const faixa = idiomaDoArquivo(nome, prefixo);
      if (!faixa) continue;
      const conteudo = await readFile(join(pasta, nome), "utf8").catch(() => null);
      if (!conteudo) continue;
      const legenda = transcricaoDaLegenda(conteudo, duracaoSegundos);
      if (!legenda || !faixaServe(faixa.lang, faixa.original, legenda.fonte, idiomaConhecido)) continue;
      const ordem = (legenda.fonte === "legenda-manual" ? 0 : 4) + (faixa.lang.startsWith("pt") ? 0 : 2) + (faixa.original ? 0 : 1);
      candidatas.push({ legenda, lang: faixa.lang, ordem });
    }
    candidatas.sort((a, b) => a.ordem - b.ordem);
    const melhor = candidatas[0];
    if (!melhor) return null;
    return { ...melhor.legenda, idioma: melhor.lang.split("-")[0] };
  } finally {
    await apagarSobrasDoDownload(pasta, prefixo);
  }
}
