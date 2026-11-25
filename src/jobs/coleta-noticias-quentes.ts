/**
 * A coleta quente de notícias (25/11/2026, desligada por padrão: `NOTICIAS_QUENTES_ATIVO`): a cada 2 horas, das 08:00 às 20:00, uma rodada leve para a notícia aparecer em até 2 horas, e não em até
 * 16. Só trabalha onde tem gente: os ramos "em uso" são exatamente os dos temas do dia (`setoresEmUsoComContagem`, a marca que abriu o aplicativo nos últimos 5 dias e que não precisa assinar).
 * Para cada um, a busca por termo no Google News (a mesma da coleta das 06:00 e das 14:00, só daquele ramo) e, uma vez por rodada, a leitura dos feeds diretos dos portais curados para a foto da
 * matéria. Não resume nada por IA e não olha os assuntos das marcas (isso fica para as duas coletas do dia). O filtro barato das notícias novas é enfileirado pelo worker depois.
 *
 * O resumo diz o peso: quantos feeds leu, quantas notícias novas entraram e quanto tempo levou, para medir o servidor antes de ligar. Nunca roda duas ao mesmo tempo: o agendamento tem
 * `singletonKey` e, por garantia, uma rodada que encontra outra em andamento no mesmo processo devolve "pulada".
 */
import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/db";
import { nichos, noticias } from "@/db/schema";
import { registrarMarcasPuladas } from "@/servicos/assinatura-tarefas";

import { baixarFeedUmaVezPorRodada } from "./coleta-assuntos";
import { rodarColetaNoticias, type DependenciasDaColeta } from "./coleta-noticias";
import { juntarFotosDasNoticiasDoSetor } from "./foto-das-noticias-do-setor";
import { setoresEmUsoComContagem } from "./temas-do-dia";

let emAndamento = false;

export type DependenciasDaColetaQuente = DependenciasDaColeta & {
  agora?: Date;
  /** Os ramos em uso; sem isto, a regra de verdade (`setoresEmUsoComContagem`). */
  ramosEmUso?: () => Promise<number[]>;
  /** A busca de um ramo; sem isto, `rodarColetaNoticias(nichoId)`. */
  coletarRamo?: (nichoId: number) => Promise<Record<string, unknown>>;
};

export async function rodarColetaNoticiasQuentes(deps: DependenciasDaColetaQuente = {}): Promise<Record<string, unknown>> {
  if (emAndamento) return { pulada: true, motivo: "outra rodada quente ainda está andando" };
  emAndamento = true;
  const inicio = Date.now();
  try {
    let ids: number[];
    if (deps.ramosEmUso) ids = await deps.ramosEmUso();
    else {
      const uso = await setoresEmUsoComContagem(deps.agora ?? new Date());
      registrarMarcasPuladas("coleta-noticias-quentes", uso.marcasPuladasPorAssinatura);
      ids = [...uso.setores];
    }
    const ramos = ids.length === 0 ? [] : await db().select({ id: nichos.id, slug: nichos.slug }).from(nichos).where(and(eq(nichos.ativo, true), inArray(nichos.id, ids)));
    if (ramos.length === 0) return { ramos: 0, feedsLidos: 0, buscasDeRamo: 0, noticiasNovas: 0, duracaoMs: Date.now() - inicio };

    const coletarRamo = deps.coletarRamo ?? ((nichoId: number) => rodarColetaNoticias(nichoId, deps));
    let buscasDeRamo = 0;
    const erros: string[] = [];
    for (const ramo of ramos) {
      try {
        const resumo = await coletarRamo(ramo.id);
        buscasDeRamo += Number(resumo.termosBuscados ?? 0);
      } catch (erro) {
        erros.push(`${ramo.slug}: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }

    // Os feeds diretos dos portais, uma vez por rodada: a foto das notícias que acabaram de chegar. Falha aqui nunca derruba a rodada.
    let feedsDiretos = 0;
    try {
      const fotos = await juntarFotosDasNoticiasDoSetor({ agora: deps.agora, baixar: baixarFeedUmaVezPorRodada(deps.baixar), buscarPagina: deps.buscarPagina });
      feedsDiretos = fotos.feedsLidos;
    } catch (erro) {
      erros.push(`fotos do setor: ${erro instanceof Error ? erro.message : String(erro)}`);
    }

    const novas = await db()
      .select({ id: noticias.id })
      .from(noticias)
      .where(and(inArray(noticias.nichoId, ramos.map((r) => r.id)), gte(noticias.coletadoEm, new Date(inicio))));

    return {
      ramos: ramos.length,
      feedsLidos: buscasDeRamo + feedsDiretos,
      buscasDeRamo,
      feedsDiretos,
      noticiasNovas: novas.length,
      duracaoMs: Date.now() - inicio,
      erros: erros.length > 0 ? erros : undefined,
    };
  } finally {
    emAndamento = false;
  }
}
