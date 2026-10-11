/**
 * E52 (PR 3), o roteiro longo: o que é conferível por código nos capítulos de um vídeo do YouTube. As regras vêm da página oficial de ajuda do YouTube sobre capítulos, baixada na base
 * de plataformas (`pesquisa/plataformas/docs/youtube/capitulos-de-video.md`) e numeradas na seção 9.4 das rubricas: `R-YT-VIDEO-05` (a descrição leva a lista de marcações de tempo, cada
 * uma com o título), `-06` (a primeira marcação é 00:00), `-07` (pelo menos três, em ordem crescente) e `-08` (cada capítulo dura no mínimo 10 segundos). O que a página NÃO diz (o máximo
 * de capítulos, o tamanho do título, o formato além do 00:00) não é regra aqui: o roteiro longo segue a medida do banco (`servicos/videos-longos.ts`).
 *
 * O modelo escreve o NOME e a DURAÇÃO de cada capítulo; o código calcula o início (a soma das durações antes dele), então "a primeira marcação é 00:00" e "em ordem crescente" valem por
 * construção e o que se confere é o que o modelo pode errar: quantos são, quanto dura cada um e se a soma é a duração pedida.
 */

import { lerCapitulosDaDescricao } from "./capitulos-da-descricao";

/** O que o YouTube pede (R-YT-VIDEO-07 e 08). */
export const MINIMO_DE_CAPITULOS_DO_YOUTUBE = 3;
export const DURACAO_MINIMA_DO_CAPITULO_S = 10;
/** Um vídeo de quarenta minutos com um capítulo por minuto já é demais para uma pessoa gravar e para quem assiste: o teto é do produto, não do YouTube. */
export const MAXIMO_DE_CAPITULOS_DO_ROTEIRO = 12;
/** Quanto a soma dos capítulos pode fugir da duração pedida (a duração de referência vem da medida do banco, e o modelo não conta segundo). */
export const FOLGA_DA_DURACAO = 0.15;

/**
 * Os limites do PRODUTO para o que o modelo escreve em volta dos capítulos (a página do YouTube não traz nenhum deles): uma fonte só, lida pelo prompt, pelo verificador e pelo golden
 * set. O título e o nome do capítulo têm o mesmo teto porque a leitura da lista da descrição (`capitulos-da-descricao.ts`) corta o nome em 100 caracteres.
 */
export const LIMITE_DO_TITULO_DO_VIDEO = 100;
export const PONTOS_MIN_POR_CAPITULO = 2;
export const PONTOS_MAX_POR_CAPITULO = 4;
export const PALAVRAS_MAX_POR_PONTO = 20;
export const PALAVRAS_MIN_NO_GANCHO_DO_CAPITULO = 4;
export const PALAVRAS_MAX_NO_GANCHO_DO_CAPITULO = 40;

export type CapituloMedido = { nome: string; duracaoS: number };

export type OpcoesDosCapitulos = {
  /** Falso: a soma não precisa chegar perto da duração pedida (a segunda tentativa: a duração do roteiro é a soma que vier, desde que ainda seja um vídeo longo). Padrão: verdadeiro. */
  exigirSoma?: boolean;
  /** A soma tem de passar disto (o teto dos curtos) e ficar até o limite do longo: um roteiro longo nunca vira um vídeo curto nem passa do que o produto trata como longo. */
  somaMaiorQueS?: number;
  somaAteS?: number;
};

/**
 * Diz se o nome sobrevive à ida e volta da lista da descrição (o que a pessoa cola e o que a leitura que mede os vídeos dos outros devolve): um nome que começa com um tempo ("10:30 da
 * manhã"), só com número ("2026"), que começa com pontuação ou passa de 100 caracteres volta cortado ou some da lista, e a marcação do capítulo deixa de valer.
 */
export function nomeNaoVoltaDaLista(nome: string): boolean {
  const limpo = nome.replace(/\s+/g, " ").trim();
  const quebra = String.fromCharCode(10);
  const lista = lerCapitulosDaDescricao(["00:00 Abertura", `01:00 ${limpo}`, "02:00 Fecho"].join(quebra), 600);
  return lista.length !== 3 || lista[1].titulo !== limpo;
}

/** O segundo em que cada capítulo começa: a soma das durações dos anteriores. O primeiro é sempre 0. */
export function iniciosDosCapitulos(capitulos: { duracaoS: number }[]): number[] {
  const inicios: number[] = [];
  let acumulado = 0;
  for (const c of capitulos) {
    inicios.push(acumulado);
    acumulado += c.duracaoS;
  }
  return inicios;
}

export function somaDosCapitulos(capitulos: { duracaoS: number }[]): number {
  return capitulos.reduce((soma, c) => soma + c.duracaoS, 0);
}

/**
 * Os motivos de reprovar a lista de capítulos (vazio quando está tudo certo). `duracaoAlvoS` é a duração que o roteiro pediu: a soma das durações tem de chegar perto dela. Os números
 * das regras vão entre parênteses, para o modelo saber de onde vem o motivo na segunda tentativa.
 */
export function verificarCapitulos(capitulos: CapituloMedido[], duracaoAlvoS: number, opcoes: OpcoesDosCapitulos = {}): string[] {
  const motivos: string[] = [];

  if (capitulos.length < MINIMO_DE_CAPITULOS_DO_YOUTUBE) {
    motivos.push(`capitulos: ${capitulos.length}, o YouTube pede pelo menos ${MINIMO_DE_CAPITULOS_DO_YOUTUBE} marcacoes de tempo (R-YT-VIDEO-07)`);
  }
  if (capitulos.length > MAXIMO_DE_CAPITULOS_DO_ROTEIRO) {
    motivos.push(`capitulos: ${capitulos.length}, no maximo ${MAXIMO_DE_CAPITULOS_DO_ROTEIRO} para um video que uma pessoa grava`);
  }

  capitulos.forEach((c, i) => {
    if (!c.nome.trim()) motivos.push(`capitulo ${i + 1}: sem nome (R-YT-VIDEO-05, cada marcacao tem o seu titulo)`);
    else if (c.nome.includes("[") || c.nome.includes("]")) {
      motivos.push(`capitulo ${i + 1}: o nome leva espaco marcado entre colchetes; o nome vai para a descricao do video, o espaco marcado fica nos pontos`);
    } else if (nomeNaoVoltaDaLista(c.nome)) {
      motivos.push(
        `capitulo ${i + 1}: o nome "${c.nome.trim().slice(0, 40)}" nao volta igual da lista da descricao (R-YT-VIDEO-05): comece por uma palavra, sem tempo nem numero nem pontuacao no comeco, e ate ${LIMITE_DO_TITULO_DO_VIDEO} caracteres`,
      );
    }
    if (!Number.isFinite(c.duracaoS) || c.duracaoS < DURACAO_MINIMA_DO_CAPITULO_S) {
      motivos.push(`capitulo ${i + 1}: dura ${Number.isFinite(c.duracaoS) ? Math.round(c.duracaoS) : "?"} s, o minimo e ${DURACAO_MINIMA_DO_CAPITULO_S} s (R-YT-VIDEO-08)`);
    }
  });

  const soma = somaDosCapitulos(capitulos);
  // Arredondado ao centésimo: 220 * 1.15 em ponto flutuante dá 252,99999999999997, e uma soma de 253 s (a borda, que vale) reprovaria.
  const menor = Math.round(duracaoAlvoS * (1 - FOLGA_DA_DURACAO) * 100) / 100;
  const maior = Math.round(duracaoAlvoS * (1 + FOLGA_DA_DURACAO) * 100) / 100;
  if ((opcoes.exigirSoma ?? true) && (soma < menor || soma > maior)) {
    motivos.push(
      `capitulos: a soma das duracoes e ${Math.round(soma)} s e o video pedido tem ${Math.round(duracaoAlvoS)} s (entre ${Math.round(menor)} e ${Math.round(maior)} s); as duracoes dos capitulos tem de somar a duracao do video`,
    );
  }
  if (opcoes.somaMaiorQueS !== undefined && soma <= opcoes.somaMaiorQueS) {
    motivos.push(`capitulos: a soma das duracoes e ${Math.round(soma)} s, que e um video curto (ate ${opcoes.somaMaiorQueS} s); o video longo passa disso`);
  }
  if (opcoes.somaAteS !== undefined && soma > opcoes.somaAteS) {
    motivos.push(`capitulos: a soma das duracoes e ${Math.round(soma)} s, mais que o maximo de ${opcoes.somaAteS} s de um video longo`);
  }

  return motivos;
}

/** "00:00", "09:05", "1:02:03": o tempo como a lista da descrição do YouTube o escreve (dois dígitos nos minutos até uma hora; a hora só quando passa de uma hora). */
export function tempoParaADescricao(segundos: number): string {
  const total = Math.max(0, Math.round(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dois = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${dois(m)}:${dois(s)}`;
}

/**
 * O texto do "Copiar os capítulos": uma marcação por linha, o tempo e o título (R-YT-VIDEO-05), a primeira em 00:00 (-06), em ordem crescente (-07). É o que a pessoa cola na descrição do
 * vídeo; o formato é provado por `lerCapitulosDaDescricao` (a mesma leitura que mede os vídeos dos outros), que tem de devolver os mesmos capítulos.
 */
export function capitulosParaCopiar(capitulos: { nome: string; duracaoS: number }[]): string {
  const inicios = iniciosDosCapitulos(capitulos);
  return capitulos.map((c, i) => `${tempoParaADescricao(inicios[i])} ${c.nome.replace(/\s+/g, " ").trim()}`).join("\n");
}
