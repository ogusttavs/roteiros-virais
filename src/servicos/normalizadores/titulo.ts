/**
 * Titulo de video para TikTok e Instagram (`PROXIMO.md`, E6 parte 3, item 3):
 * os dois atores nao trazem um campo de titulo de verdade, so a descricao
 * (TikTok: `item.text`; Instagram: `item.caption`). Sem titulo, um cartao de
 * Referencias ficava sem nada para mostrar (achado do Gustavo em 07/09); a
 * primeira linha da descricao, ou a data por extenso quando nao ha
 * descricao nenhuma, garante que sempre existe algo. Usado pelo
 * normalizador (video novo) e por `scripts/corrigir-titulos.ts` (o que ja
 * esta no banco), para as duas trilhas nunca divergirem.
 */
const MAX_CARACTERES_TITULO = 90;

const FORMATAR_DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

/**
 * Sem `publicadoEm` (a plataforma as vezes nao devolve a data), o titulo
 * fica so "vídeo de @conta": caso sem exemplo no `PROXIMO.md`, decisao
 * registrada aqui em vez de inventar uma data.
 */
export function tituloDeVideo(descricao: string | null, handle: string, publicadoEm: Date | null): string {
  const primeiraLinha = descricao?.split("\n")[0]?.trim();
  if (primeiraLinha) return primeiraLinha.slice(0, MAX_CARACTERES_TITULO);
  if (publicadoEm) return `vídeo de @${handle}, ${FORMATAR_DATA.format(publicadoEm)}`;
  return `vídeo de @${handle}`;
}
