/**
 * E22 PR 3: as tarefas diárias por marca respeitam a assinatura. Com a cobrança ligada (`COBRANCA_ATIVA=1`), a marca sem assinatura que vale e sem cortesia não recebe os jobs que
 * gastam IA ou coleta paga por conta dela (temas do dia, aprender com o cliente, entender a marca, análise de perfil, pesquisa na hora, curva, notícias dos assuntos, lembrete).
 * Com a cobrança desligada, NADA muda: `separarMarcasPorAssinatura` devolve todas as marcas liberadas sem tocar no banco.
 *
 * Os jobs por ramo (coleta, transcrição, extração, modelo do ramo) continuam para todos os ramos ligados: a base compartilhada não pode envelhecer. O que muda é o que conta um ramo
 * como "em uso" (`setoresEmUso`): ele só conta com ao menos uma marca que não precisa assinar.
 *
 * Marca que não existe no banco (apagada entre o enfileirar e o rodar) conta como liberada: o job que a recebe já trata "marca não encontrada" do jeito dele, e esta trava nunca esconde
 * esse erro.
 */
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { assinaturas, clientes } from "@/db/schema";
import { config } from "@/lib/config";
import { logger } from "@/lib/log";

import { precisaAssinarCom } from "./assinatura";

export type OpcoesDaTrava = {
  agora?: Date;
  /** Para teste: sobrescreve `config.cobranca.ativa`. */
  cobrancaAtiva?: boolean;
};

export type SeparacaoPorAssinatura = {
  /** Os ids das marcas que podem receber a tarefa. */
  liberadas: Set<number>;
  /** Os ids das marcas puladas por falta de assinatura (sem repetição). */
  puladas: number[];
};

/** Separa as marcas em liberadas e puladas, com uma consulta só para todas. Cobrança desligada: todas liberadas, sem consulta. */
export async function separarMarcasPorAssinatura(ids: readonly number[], opcoes: OpcoesDaTrava = {}): Promise<SeparacaoPorAssinatura> {
  const unicos = [...new Set(ids)];
  const cobrancaAtiva = opcoes.cobrancaAtiva ?? config.cobranca.ativa;
  if (!cobrancaAtiva || unicos.length === 0) return { liberadas: new Set(unicos), puladas: [] };

  const agora = opcoes.agora ?? new Date();
  const marcas = await db().select({ id: clientes.id, cortesia: clientes.cortesia }).from(clientes).where(inArray(clientes.id, unicos));
  const assinaturasDasMarcas = await db()
    .select({ clienteId: assinaturas.clienteId, status: assinaturas.status, periodoFim: assinaturas.periodoFim })
    .from(assinaturas)
    .where(inArray(assinaturas.clienteId, unicos));
  const porMarca = new Map<number, { status: (typeof assinaturasDasMarcas)[number]["status"]; periodoFim: Date | null }[]>();
  for (const a of assinaturasDasMarcas) {
    const lista = porMarca.get(a.clienteId) ?? [];
    lista.push({ status: a.status, periodoFim: a.periodoFim });
    porMarca.set(a.clienteId, lista);
  }

  const existentes = new Map(marcas.map((m) => [m.id, m.cortesia]));
  const liberadas = new Set<number>();
  const puladas: number[] = [];
  for (const id of unicos) {
    const cortesia = existentes.get(id);
    // Marca que não existe: liberada (ver o comentário do arquivo).
    const precisa = cortesia === undefined ? false : precisaAssinarCom({ cobrancaAtiva, cortesia, assinaturas: porMarca.get(id) ?? [], agora });
    if (precisa) puladas.push(id);
    else liberadas.add(id);
  }
  return { liberadas, puladas };
}

/** Filtra uma lista de itens que carregam o id da marca, e diz quantas marcas ficaram de fora. */
export async function filtrarPorAssinatura<T>(
  itens: readonly T[],
  idDaMarca: (item: T) => number,
  opcoes: OpcoesDaTrava = {},
): Promise<{ itens: T[]; marcasPuladas: number }> {
  const { liberadas, puladas } = await separarMarcasPorAssinatura(itens.map(idDaMarca), opcoes);
  return { itens: itens.filter((item) => liberadas.has(idDaMarca(item))), marcasPuladas: puladas.length };
}

/** Uma marca só: ela pode receber a tarefa? (Os jobs por evento, que chegam com um `clienteId`.) */
export async function marcaPodeReceberTarefa(clienteId: number, opcoes: OpcoesDaTrava = {}): Promise<boolean> {
  return (await separarMarcasPorAssinatura([clienteId], opcoes)).liberadas.has(clienteId);
}

/** O que o job escreve no log e no resumo da execução quando pulou marcas por assinatura. Zero: não escreve nada. */
export function registrarMarcasPuladas(job: string, marcasPuladas: number): void {
  if (marcasPuladas > 0) logger.info({ job, marcasPuladasPorAssinatura: marcasPuladas }, "tarefa diaria: marcas sem assinatura foram puladas");
}

/** O pedaço do resumo do job (vai para `execucoes_job.resumo`): presente só quando alguma marca foi pulada, para o resumo de quem não cobra ficar igual ao de sempre. */
export function resumoDasMarcasPuladas(marcasPuladas: number): { marcasPuladasPorAssinatura?: number } {
  return marcasPuladas > 0 ? { marcasPuladasPorAssinatura: marcasPuladas } : {};
}
