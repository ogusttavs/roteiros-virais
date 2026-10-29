/**
 * E47 PR 4: a legenda e o título do primeiro quadro como arquivo de legenda ASS, que o ffmpeg (libass) queima no vídeo. Tudo puro: recebe os blocos que o motor de legenda montou e devolve o texto
 * do arquivo. O visual é o que o Gustavo aprovou nas edições dele (27 e 28/10/2026): caixa branca com texto preto, caixa alta, blocos curtos, título em pergunta no primeiro quadro, na mesma caixa.
 *
 * O arquivo sempre declara a tela de 1080x1920; o libass escala tudo para a prévia (540x960) sem mudar de lugar nem de tamanho. As margens deixam a legenda acima da área da interface do Reels
 * (a barra de baixo e a legenda do próprio post) e o título abaixo da barra de cima.
 */
import { AJUSTES_DO_RENDER } from "@/config/edicao";

import type { BlocoLegenda } from "./tipos";

export const TELA_DO_ASS = { largura: 1080, altura: 1920 } as const;

/** O nome da família da fonte embutida (`src/edicao/fontes/Montserrat-Bold.ttf`). */
export const FONTE_DA_LEGENDA = "Montserrat";

/** Maior linha do título, em letras: em caixa alta e negrito cabe na largura com a caixa e as margens. */
const LETRAS_POR_LINHA_DO_TITULO = 20;
const LINHAS_DO_TITULO_NO_MAXIMO = 3;

/** `H:MM:SS.cc`, o tempo que o ASS usa (centésimos de segundo). */
export function tempoDoAss(segundos: number): string {
  const total = Math.max(0, Math.round(segundos * 100));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${h}:${dois(m)}:${dois(s)}.${dois(cs)}`;
}

/** O texto vira uma linha só e sem nada que o ASS leia como comando (`{...}`, barra invertida). */
export function textoSeguroDoAss(texto: string): string {
  return texto
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[{}\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Quebra o título em até 3 linhas de até 20 letras, sem partir palavra. Uma palavra maior que a linha fica sozinha. */
export function linhasDoTitulo(texto: string): string[] {
  const palavras = textoSeguroDoAss(texto).split(" ").filter(Boolean);
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of palavras) {
    if (atual === "") atual = palavra;
    else if (atual.length + 1 + palavra.length <= LETRAS_POR_LINHA_DO_TITULO) atual += ` ${palavra}`;
    else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual !== "") linhas.push(atual);
  if (linhas.length <= LINHAS_DO_TITULO_NO_MAXIMO) return linhas;
  // Mais linhas que o limite: junta o excedente na última (o verificador já limita o título a 10 palavras, então isto é só uma rede).
  return [...linhas.slice(0, LINHAS_DO_TITULO_NO_MAXIMO - 1), linhas.slice(LINHAS_DO_TITULO_NO_MAXIMO - 1).join(" ")];
}

export type EntradaDoAss = {
  blocos: BlocoLegenda[];
  titulo: { texto: string; subtitulo: string | null };
  /** Duração do vídeo, com o respiro final. O título nunca passa disto. */
  duracaoS: number;
};

// As cores do ASS são &HAABBGGRR. Texto preto, caixa branca.
const PRETO = "&H00000000";
const BRANCO = "&H00FFFFFF";

/** Um estilo de caixa (BorderStyle 3: a cor da caixa é a cor do contorno, e o contorno é o respiro da caixa em volta do texto). */
function estilo(nome: string, tamanho: number, caixa: number, alinhamento: number, margemVertical: number): string {
  return `Style: ${nome},${FONTE_DA_LEGENDA},${tamanho},${PRETO},${PRETO},${BRANCO},${PRETO},-1,0,0,0,100,100,0,0,3,${caixa},0,${alinhamento},60,60,${margemVertical},1`;
}

/** O arquivo ASS completo. */
export function montarAss(entrada: EntradaDoAss): string {
  const { blocos, titulo, duracaoS } = entrada;
  const linhas: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${TELA_DO_ASS.largura}`,
    `PlayResY: ${TELA_DO_ASS.altura}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Legenda: embaixo, a um quarto da altura do chão (acima da interface do Reels).
    estilo("Legenda", 72, 14, 2, 480),
    // Título: no alto, abaixo da barra de cima.
    estilo("Titulo", 62, 16, 8, 330),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  for (const bloco of blocos) {
    const texto = textoSeguroDoAss(bloco.texto);
    if (texto === "" || bloco.fim <= bloco.inicio) continue;
    linhas.push(`Dialogue: 0,${tempoDoAss(bloco.inicio)},${tempoDoAss(Math.min(bloco.fim, duracaoS))},Legenda,,0,0,0,,${texto}`);
  }

  const partes = linhasDoTitulo(titulo.texto.toLocaleUpperCase("pt-BR"));
  if (partes.length > 0) {
    const sub = titulo.subtitulo ? textoSeguroDoAss(titulo.subtitulo).toLocaleUpperCase("pt-BR") : "";
    const texto = [...partes, ...(sub ? [`{\\fs48}${sub}`] : [])].join("\\N");
    const fim = Math.min(AJUSTES_DO_RENDER.tituloS, duracaoS);
    linhas.push(`Dialogue: 1,${tempoDoAss(0)},${tempoDoAss(fim)},Titulo,,0,0,0,,${texto}`);
  }
  return `${linhas.join("\n")}\n`;
}
