/**
 * O filtro das notícias do ramo (fix de 22/10/2026, Notícias): a coleta traz de 85 a 250 notícias por dia por ramo, e só as que o modelo barato (`filtrarNoticias`) marca como do interesse de
 * quem toca aquele negócio chegam à tela de Notícias e aos temas. Antes o filtro só rodava dentro do `temas-do-dia`, por ramo em uso, e quem chegava num ramo novo ficava sem Notícias até o dia
 * seguinte; agora ele tem job próprio (`jobs/filtrar-noticias.ts`), enfileirado quando a marca chega e depois de cada coleta. Este arquivo tem as regras e o acesso ao banco; o `temas-do-dia`
 * usa as mesmas funções.
 *
 * Regra de data (mesma da tela): notícia publicada há mais de 7 dias, ou sem data, nunca é candidata. O Google News devolve matéria antiga misturada à de hoje, e a coleta grava por
 * `coletado_em`; sem esta regra, 6 das 8 "relevantes" de um dia eram de dezembro a setembro.
 */
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";

import { db } from "@/db";
import { clientes, noticias, ramosDaConta } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as filtrarNoticiasIA from "@/ia/prompts/filtrarNoticias";
import { registrarGeracao } from "@/ia/registro";
import { boss, garantirBossPronto, FILAS } from "@/jobs/fila";
import { inicioDaJanelaDeNoticias, TOLERANCIA_DE_FUTURO_MS } from "@/lib/janela-de-noticias";
import { logger } from "@/lib/log";

export { DIAS_MAXIMOS_DA_NOTICIA, inicioDaJanelaDeNoticias, noticiaEhCandidata } from "@/lib/janela-de-noticias";

/** Quantas notícias vão numa chamada ao modelo barato. */
export const NOTICIAS_POR_LOTE = 60;
/** Quantas chamadas, no máximo, um ramo faz por rodada (a mais recente primeiro; o resto fica para a rodada seguinte). Segura o custo de um ramo que chega com a semana inteira para filtrar. */
export const LOTES_POR_RODADA = 4;

export type NoticiaCandidata = { id: number; titulo: string; resumo: string | null };
export type RamoParaOFiltro = { id: number; nome: string; termos: string[] };

/** As candidatas ainda sem veredito do ramo, as mais recentes primeiro. `coletadasDesde` é a janela de coleta do `temas-do-dia` (as últimas 24 horas); o job de filtro não usa. */
export async function candidatasDoRamo(
  nichoId: number,
  opcoes: { agora?: Date; limite?: number; coletadasDesde?: Date } = {},
): Promise<NoticiaCandidata[]> {
  const agora = opcoes.agora ?? new Date();
  const condicoes = [
    eq(noticias.nichoId, nichoId),
    isNull(noticias.relevante),
    gte(noticias.publicadoEm, inicioDaJanelaDeNoticias(agora)),
    lte(noticias.publicadoEm, new Date(agora.getTime() + TOLERANCIA_DE_FUTURO_MS)),
  ];
  if (opcoes.coletadasDesde) condicoes.push(gte(noticias.coletadoEm, opcoes.coletadasDesde));
  return db()
    .select({ id: noticias.id, titulo: noticias.titulo, resumo: noticias.resumo })
    .from(noticias)
    .where(and(...condicoes))
    .orderBy(desc(noticias.publicadoEm), desc(noticias.id))
    .limit(opcoes.limite ?? NOTICIAS_POR_LOTE);
}

/**
 * Uma chamada ao modelo barato: grava `relevante` e `angulo` em cada notícia do lote (nunca reprocessa a mesma) e devolve só as relevantes, com o id delas. A gravação só vale se a notícia ainda
 * está sem veredito (duas rodadas do mesmo ramo ao mesmo tempo não se atropelam).
 */
export async function filtrarLoteDeNoticias(ramo: RamoParaOFiltro, candidatas: NoticiaCandidata[]): Promise<NoticiaCandidata[]> {
  if (candidatas.length === 0) return [];

  const resultado = await gerarEstruturado({
    tarefa: "filtrarNoticias",
    nivel: filtrarNoticiasIA.nivel,
    effort: filtrarNoticiasIA.esforco,
    schema: filtrarNoticiasIA.schema,
    sistemaEstavel: filtrarNoticiasIA.montarSistemaEstavel(),
    entrada: filtrarNoticiasIA.montarEntrada({
      nomeNicho: ramo.nome,
      termosNicho: ramo.termos,
      noticias: candidatas.map((n) => ({ titulo: n.titulo, resumo: n.resumo })),
    }),
  });

  await registrarGeracao({
    tarefa: "filtrarNoticias",
    versaoPrompt: filtrarNoticiasIA.versao,
    modelo: resultado.modelo,
    nivel: filtrarNoticiasIA.nivel,
    entradas: { nichoId: ramo.id, noticias: candidatas.length },
    saida: resultado.dados,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
  });

  const anguloPorIndice = new Map(resultado.dados.relevantes.map((r) => [r.indice, r.angulo]));

  for (const [i, candidata] of candidatas.entries()) {
    const angulo = anguloPorIndice.get(i + 1) ?? null;
    await db()
      .update(noticias)
      .set({ relevante: angulo !== null, angulo })
      .where(and(eq(noticias.id, candidata.id), isNull(noticias.relevante)));
  }

  return candidatas.filter((_, i) => anguloPorIndice.has(i + 1));
}

export type ResumoDoFiltroDoRamo = { lotes: number; candidatas: number; relevantes: number };

/**
 * Filtra as notícias do ramo ainda sem veredito, em lotes de `NOTICIAS_POR_LOTE`, até `lotes` chamadas (padrão `LOTES_POR_RODADA`): as mais recentes primeiro, o que sobra espera a rodada
 * seguinte. Sem candidata, nenhuma chamada (custo zero).
 */
export async function filtrarNoticiasDoRamo(
  ramo: RamoParaOFiltro,
  opcoes: { agora?: Date; lotes?: number; coletadasDesde?: Date } = {},
): Promise<ResumoDoFiltroDoRamo> {
  const resumo: ResumoDoFiltroDoRamo = { lotes: 0, candidatas: 0, relevantes: 0 };
  const maximo = opcoes.lotes ?? LOTES_POR_RODADA;
  while (resumo.lotes < maximo) {
    const candidatas = await candidatasDoRamo(ramo.id, { agora: opcoes.agora, coletadasDesde: opcoes.coletadasDesde });
    if (candidatas.length === 0) break;
    const relevantes = await filtrarLoteDeNoticias(ramo, candidatas);
    resumo.lotes += 1;
    resumo.candidatas += candidatas.length;
    resumo.relevantes += relevantes.length;
    // Menos que um lote cheio: acabaram as candidatas deste ramo.
    if (candidatas.length < NOTICIAS_POR_LOTE) break;
  }
  return resumo;
}

/** As relevantes do ramo que a coleta trouxe desde `coletadasDesde`, ainda dentro dos 7 dias, as mais recentes primeiro (a evidência de notícia do `temas-do-dia`). */
export async function relevantesDoRamo(
  nichoId: number,
  opcoes: { agora?: Date; coletadasDesde: Date; limite?: number },
): Promise<NoticiaCandidata[]> {
  const agora = opcoes.agora ?? new Date();
  return db()
    .select({ id: noticias.id, titulo: noticias.titulo, resumo: noticias.resumo })
    .from(noticias)
    .where(
      and(
        eq(noticias.nichoId, nichoId),
        eq(noticias.relevante, true),
        gte(noticias.coletadoEm, opcoes.coletadasDesde),
        gte(noticias.publicadoEm, inicioDaJanelaDeNoticias(agora)),
      ),
    )
    .orderBy(desc(noticias.publicadoEm), desc(noticias.id))
    .limit(opcoes.limite ?? 12);
}

/**
 * Pede o filtro de um ramo na fila (a marca acabou de chegar: briefing terminado, conta criada pelo admin, ramo trocado ou aberto a tela de Notícias). No máximo um pedido por ramo a cada
 * `janelaSegundos` (o `singletonKey`), para uma tela que se atualiza nunca encher a fila. Nunca derruba quem chamou: se a fila estiver fora do ar, o erro vai só para o log e a próxima
 * coleta (06:00 e 14:00) filtra de qualquer jeito. Devolve se algo foi enfileirado.
 */
export async function pedirFiltroDeNoticias(nichoId: number | null | undefined, janelaSegundos = 600): Promise<boolean> {
  if (!nichoId) return false;
  try {
    await garantirBossPronto();
    const id = await boss().send(FILAS.filtrarNoticias, { nichoId }, { singletonKey: `filtrar-noticias-${nichoId}`, singletonSeconds: janelaSegundos });
    return id !== null;
  } catch (erro) {
    logger.error({ err: erro, nichoId }, "nao foi possivel pedir o filtro das noticias do ramo");
    return false;
  }
}

/**
 * A marca acabou de chegar (briefing terminado, conta criada, ramo trocado): pede o filtro do ramo principal dela e dos alternativos. Só quem tem ramo; nunca derruba quem chamou (a fila já não derruba).
 */
export async function pedirFiltroDeNoticiasDaMarca(clienteId: number): Promise<void> {
  try {
    const [marca] = await db().select({ nichoId: clientes.nichoId, ativo: clientes.ativo }).from(clientes).where(eq(clientes.id, clienteId));
    if (!marca?.ativo) return;
    const alternativos = await db().select({ nichoId: ramosDaConta.nichoId }).from(ramosDaConta).where(eq(ramosDaConta.clienteId, clienteId));
    const ramos = new Set<number>(alternativos.map((a) => a.nichoId));
    if (marca.nichoId) ramos.add(marca.nichoId);
    for (const nichoId of ramos) await pedirFiltroDeNoticias(nichoId);
  } catch (erro) {
    logger.error({ err: erro, clienteId }, "nao foi possivel pedir o filtro das noticias da marca");
  }
}
