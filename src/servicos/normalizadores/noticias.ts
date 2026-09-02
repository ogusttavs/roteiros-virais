/**
 * Normalizador de noticias (etapa 6): funcao pura, item bruto do RSS do
 * Google News, saida no formato que `noticias` espera. O titulo do Google
 * News vem como "Manchete - Fonte"; separamos os dois quando da para saber
 * qual e a fonte.
 */
import type Parser from "rss-parser";

export type NoticiaNormalizada = {
  titulo: string;
  url: string;
  fonte: string | null;
  publicadoEm: Date | null;
  resumo: string | null;
};

export function normalizarNoticiaRss(item: Parser.Item): NoticiaNormalizada {
  const tituloCompleto = item.title?.trim() ?? "";
  const partes = tituloCompleto.split(" - ");
  const temFonte = partes.length > 1;
  const fonte = temFonte ? partes[partes.length - 1].trim() : null;
  const titulo = temFonte ? partes.slice(0, -1).join(" - ").trim() : tituloCompleto;

  const dataTexto = item.isoDate ?? item.pubDate;

  return {
    titulo: titulo || tituloCompleto,
    url: item.link?.trim() ?? "",
    fonte: fonte || null,
    publicadoEm: dataTexto ? new Date(dataTexto) : null,
    resumo: item.contentSnippet?.trim() || item.summary?.trim() || null,
  };
}
