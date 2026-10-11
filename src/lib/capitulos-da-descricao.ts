/**
 * E52 (PR 1), o vídeo longo do YouTube: os capítulos que o dono do vídeo escreveu na descrição ("0:00 Abertura", "2:15 O erro mais comum"...). É a estrutura de graça: a API do YouTube
 * já traz a descrição de todo vídeo coletado, então o desenho de capítulos dos longos do setor sai sem transcrever nenhum (a transcrição de um longo custa dez vezes a de um curto).
 *
 * É uma leitura por código, nunca por modelo, e é uma LEITURA nossa da lista de quem postou: não afirma nada sobre o que o YouTube exige para o capítulo aparecer na barra (isso é da
 * base de plataformas, `pesquisa/plataformas/`). Aceita uma lista só quando parece mesmo uma lista de capítulos: três ou mais linhas seguidas, a primeira em 0:00, os tempos sempre
 * crescendo e todos dentro da duração do vídeo. Qualquer outra coisa com horário na descrição (um "às 10:30", um link) fica de fora.
 */

export type CapituloDaDescricao = { inicioS: number; titulo: string };

/** O mínimo de linhas seguidas para valer como lista de capítulos. */
const MINIMO_DE_CAPITULOS = 3;
const TITULO_MAXIMO = 100;

/**
 * Uma linha da lista: marcador opcional (ponto, seta, traço, emoji, espaço invisível), o tempo (m:ss ou h:mm:ss, com ou sem colchete), um segundo tempo opcional (a lista
 * de intervalo, "0:00-0:30 Abertura") e o título, separado por traço, dois-pontos, barra ou só espaço. Os travessões vão por código de caractere (U+2013 e U+2014) para o arquivo não carregar o caractere.
 */
const LINHA = /^[\s\u2022\u25B6\u25BA\u2023\u25CF\u00B7\u200B\uFE0F\p{Extended_Pictographic}*>\u2013\u2014-]*[(\[]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?[\s\u2013\u2014:|.)-]*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}[\s\u2013\u2014:|.)-]*)?(\S.*)$/u;

function segundosDe(tempo: string): number | null {
  const partes = tempo.split(":").map((p) => Number(p));
  if (partes.some((p) => !Number.isFinite(p))) return null;
  if (partes.length === 3) {
    const [h, m, s] = partes;
    return m < 60 && s < 60 ? h * 3600 + m * 60 + s : null;
  }
  const [m, s] = partes;
  return s < 60 ? m * 60 + s : null;
}

function tituloLimpo(bruto: string): string {
  return Array.from(bruto.replace(/\s+/g, " ").trim()).slice(0, TITULO_MAXIMO).join("").trim();
}

/** Não há título quando o que sobra é só número e pontuação (uma linha de horário solta, "10:30 - 11:00"). */
function temLetra(texto: string): boolean {
  return /\p{L}/u.test(texto);
}

/**
 * A primeira lista de capítulos da descrição, ou vazio. `duracaoS`, quando conhecida, descarta a lista que passa do fim do vídeo (era outra coisa: uma lista de músicas de outro
 * vídeo, um horário de transmissão).
 */
export function lerCapitulosDaDescricao(descricao: string | null | undefined, duracaoS?: number | null): CapituloDaDescricao[] {
  if (!descricao) return [];
  const linhas = descricao.split(/\r?\n/);

  let corrente: CapituloDaDescricao[] = [];
  const fechar = (): CapituloDaDescricao[] | null => {
    const lista = corrente;
    corrente = [];
    if (lista.length < MINIMO_DE_CAPITULOS || lista[0].inicioS !== 0) return null;
    if (duracaoS != null && lista[lista.length - 1].inicioS >= duracaoS) return null;
    return lista;
  };

  for (const linha of linhas) {
    const achou = LINHA.exec(linha);
    const inicioS = achou ? segundosDe(achou[1]) : null;
    const titulo = achou ? tituloLimpo(achou[2]) : "";
    const valeComoCapitulo = achou !== null && inicioS !== null && temLetra(titulo);

    if (!valeComoCapitulo) {
      // A lista acaba na primeira linha que não é capítulo; uma linha em branco no meio também a fecha.
      const lista = fechar();
      if (lista) return lista;
      continue;
    }

    const anterior = corrente[corrente.length - 1];
    if (anterior && inicioS <= anterior.inicioS) {
      // Os tempos pararam de crescer: a lista de antes fecha e uma nova começa nesta linha.
      const lista = fechar();
      if (lista) return lista;
    }
    corrente.push({ inicioS, titulo });
  }

  return fechar() ?? [];
}

/** "2:40", ou "1:02:40" a partir de uma hora: o formato em que um tempo aparece numa descrição do YouTube. */
export function tempoDeCapitulo(inicioS: number): string {
  const total = Math.max(0, Math.round(inicioS));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dois = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${m}:${dois(s)}`;
}
