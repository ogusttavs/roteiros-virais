/**
 * Coleta de noticias (etapa 6): Google News RSS por termo do nicho, em
 * portugues do Brasil. Relevancia e angulo por IA ficam para a etapa 10;
 * aqui so grava o que veio. Idempotente por `noticias.url`, que e unica.
 */
import { and, eq } from "drizzle-orm";
import Parser from "rss-parser";

import { db } from "@/db";
import { nichos, noticias } from "@/db/schema";
import { normalizarNoticiaRss } from "@/servicos/normalizadores/noticias";

import { baixarFeedUmaVezPorRodada, coletarNoticiasDosAssuntos, type ResumoColetaAssuntos } from "./coleta-assuntos";
import { ErroColeta } from "./execucoes";
import { juntarFotosDasNoticiasDoSetor, type ResumoFotosDoSetor } from "./foto-das-noticias-do-setor";

const parser = new Parser();

function urlGoogleNews(termo: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(termo)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

/**
 * O que toca a rede além do Google News (que entra pelo `rss-parser`): o download dos feeds dos portais curados, da coleta dos assuntos e da foto do setor, e a leitura do `og:image` de uma
 * página. Em produção ficam os de verdade; o teste de integração passa os seus, sem rede (e conta as chamadas): a rodada de todos os setores baixa até 12 feeds com prazo de 15 s cada, e um
 * teste que chamasse a rodada inteira com o `baixarFeed` de verdade dependeria da internet de quem roda.
 */
export type DependenciasDaColeta = {
  baixar?: (url: string) => Promise<string>;
  buscarPagina?: (url: string) => Promise<string | null>;
};

/** `nichoId` (etapa 24, parte 1): mesmo raciocinio de `rodarColetaYoutube`. */
export async function rodarColetaNoticias(nichoId?: number, deps: DependenciasDaColeta = {}): Promise<Record<string, unknown>> {
  const condicao = nichoId ? and(eq(nichos.ativo, true), eq(nichos.id, nichoId)) : eq(nichos.ativo, true);
  const nichosAtivos = await db().select().from(nichos).where(condicao);

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

  // Cada feed dos portais é baixado uma vez por rodada: os assuntos e as fotos do setor leem os mesmos endereços (e um feed que não responde falha rápido na segunda vez, em vez de esperar o prazo de novo).
  const baixarDaRodada = baixarFeedUmaVezPorRodada(deps.baixar);

  // E53: as notícias dos assuntos que as marcas acompanham, no mesmo job (só na rodada de todos os setores). Nunca derruba a coleta por setor: se falhar, o erro vai para o resumo.
  let assuntosColetados: ResumoColetaAssuntos | undefined;
  if (nichoId === undefined) {
    try {
      assuntosColetados = await coletarNoticiasDosAssuntos({ baixar: baixarDaRodada, buscarPagina: deps.buscarPagina });
    } catch (erro) {
      erros.push(`assuntos: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  // E53 (foto do setor): as notícias do setor ganham a foto do RSS direto dos portais curados, quando o título bate. Também só na rodada de todos os setores, e nunca derruba a coleta.
  let fotos: ResumoFotosDoSetor | undefined;
  if (nichoId === undefined) {
    try {
      fotos = await juntarFotosDasNoticiasDoSetor({ baixar: baixarDaRodada, buscarPagina: deps.buscarPagina });
    } catch (erro) {
      erros.push(`fotos do setor: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  if (termosBuscados === 0 && !assuntosColetados?.assuntos) {
    throw new ErroColeta("nenhum termo para coletar (sem nichos ativos)", false);
  }
  if (noticiasProcessadas === 0 && termosBuscados > 0 && erros.length > 0 && !assuntosColetados?.noticiasNovas) {
    throw new ErroColeta(`coleta de noticias falhou em tudo: ${erros.join("; ")}`, true);
  }

  return {
    nichos: nichosAtivos.length,
    termosBuscados,
    noticiasProcessadas,
    assuntos: assuntosColetados,
    fotos,
    erros: erros.length > 0 ? erros : undefined,
  };
}
