/**
 * Coleta de noticias (etapa 6): Google News RSS por termo do nicho, em
 * portugues do Brasil. Relevancia e angulo por IA ficam para a etapa 10;
 * aqui so grava o que veio. Idempotente por `noticias.url`, que e unica.
 */
import { eq } from "drizzle-orm";
import Parser from "rss-parser";

import { db } from "@/db";
import { nichos, noticias } from "@/db/schema";
import { normalizarNoticiaRss } from "@/servicos/normalizadores/noticias";

import { ErroColeta } from "./execucoes";

const parser = new Parser();

function urlGoogleNews(termo: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(termo)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

export async function rodarColetaNoticias(): Promise<Record<string, unknown>> {
  const nichosAtivos = await db().select().from(nichos).where(eq(nichos.ativo, true));

  let termosBuscados = 0;
  let noticiasProcessadas = 0;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    for (const termo of nicho.termos) {
      termosBuscados += 1;
      try {
        const feed = await parser.parseURL(urlGoogleNews(termo));
        for (const item of feed.items) {
          const normalizada = normalizarNoticiaRss(item);
          if (!normalizada.url || !normalizada.titulo) continue;

          await db()
            .insert(noticias)
            .values({ ...normalizada, nichoId: nicho.id })
            .onConflictDoUpdate({
              target: noticias.url,
              set: {
                titulo: normalizada.titulo,
                fonte: normalizada.fonte,
                publicadoEm: normalizada.publicadoEm,
                resumo: normalizada.resumo,
              },
            });
          noticiasProcessadas += 1;
        }
      } catch (erro) {
        erros.push(`${nicho.slug} / "${termo}": ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
  }

  if (termosBuscados === 0) {
    throw new ErroColeta("nenhum termo para coletar (sem nichos ativos)", false);
  }
  if (noticiasProcessadas === 0 && erros.length > 0) {
    throw new ErroColeta(`coleta de noticias falhou em tudo: ${erros.join("; ")}`, true);
  }

  return {
    nichos: nichosAtivos.length,
    termosBuscados,
    noticiasProcessadas,
    erros: erros.length > 0 ? erros : undefined,
  };
}
