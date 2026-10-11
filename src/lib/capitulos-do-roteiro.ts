/**
 * E52 (PR 3), o roteiro longo: o que é conferível por código nos capítulos de um vídeo do YouTube. As regras vêm da página oficial de ajuda do YouTube sobre capítulos, baixada na base
 * de plataformas (`pesquisa/plataformas/docs/youtube/capitulos-de-video.md`) e numeradas na seção 9.4 das rubricas: `R-YT-VIDEO-05` (a descrição leva a lista de marcações de tempo, cada
 * uma com o título), `-06` (a primeira marcação é 00:00), `-07` (pelo menos três, em ordem crescente) e `-08` (cada capítulo dura no mínimo 10 segundos). O que a página NÃO diz (o máximo
 * de capítulos, o tamanho do título, o formato além do 00:00) não é regra aqui: o roteiro longo segue a medida do banco (`servicos/videos-longos.ts`).
 *
 * O modelo escreve o NOME e a DURAÇÃO de cada capítulo; o código calcula o início (a soma das durações antes dele), então "a primeira marcação é 00:00" e "em ordem crescente" valem por
 * construção e o que se confere é o que o modelo pode errar: quantos são, quanto dura cada um e se a soma é a duração pedida.
 */

/** O que o YouTube pede (R-YT-VIDEO-07 e 08). */
export const MINIMO_DE_CAPITULOS_DO_YOUTUBE = 3;
export const DURACAO_MINIMA_DO_CAPITULO_S = 10;
/** Um vídeo de quarenta minutos com um capítulo por minuto já é demais para uma pessoa gravar e para quem assiste: o teto é do produto, não do YouTube. */
export const MAXIMO_DE_CAPITULOS_DO_ROTEIRO = 12;
/** Quanto a soma dos capítulos pode fugir da duração pedida (a duração de referência vem da medida do banco, e o modelo não conta segundo). */
export const FOLGA_DA_DURACAO = 0.15;

export type CapituloMedido = { nome: string; duracaoS: number };

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
export function verificarCapitulos(capitulos: CapituloMedido[], duracaoAlvoS: number): string[] {
  const motivos: string[] = [];

  if (capitulos.length < MINIMO_DE_CAPITULOS_DO_YOUTUBE) {
    motivos.push(`capitulos: ${capitulos.length}, o YouTube pede pelo menos ${MINIMO_DE_CAPITULOS_DO_YOUTUBE} marcacoes de tempo (R-YT-VIDEO-07)`);
  }
  if (capitulos.length > MAXIMO_DE_CAPITULOS_DO_ROTEIRO) {
    motivos.push(`capitulos: ${capitulos.length}, no maximo ${MAXIMO_DE_CAPITULOS_DO_ROTEIRO} para um video que uma pessoa grava`);
  }

  capitulos.forEach((c, i) => {
    if (!c.nome.trim()) motivos.push(`capitulo ${i + 1}: sem nome (R-YT-VIDEO-05, cada marcacao tem o seu titulo)`);
    if (!Number.isFinite(c.duracaoS) || c.duracaoS < DURACAO_MINIMA_DO_CAPITULO_S) {
      motivos.push(`capitulo ${i + 1}: dura ${Number.isFinite(c.duracaoS) ? Math.round(c.duracaoS) : "?"} s, o minimo e ${DURACAO_MINIMA_DO_CAPITULO_S} s (R-YT-VIDEO-08)`);
    }
  });

  const soma = somaDosCapitulos(capitulos);
  // Arredondado ao centésimo: 220 * 1.15 em ponto flutuante dá 252,99999999999997, e uma soma de 253 s (a borda, que vale) reprovaria.
  const menor = Math.round(duracaoAlvoS * (1 - FOLGA_DA_DURACAO) * 100) / 100;
  const maior = Math.round(duracaoAlvoS * (1 + FOLGA_DA_DURACAO) * 100) / 100;
  if (soma < menor || soma > maior) {
    motivos.push(
      `capitulos: a soma das duracoes e ${Math.round(soma)} s e o video pedido tem ${Math.round(duracaoAlvoS)} s (entre ${Math.round(menor)} e ${Math.round(maior)} s); as duracoes dos capitulos tem de somar a duracao do video`,
    );
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
