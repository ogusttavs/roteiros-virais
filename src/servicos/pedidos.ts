/**
 * E74 PR 2a: o pedido de geração (`pedidos_de_geracao`), o que a tela acompanha em vez de esperar a resposta da escrita. Desenho em `estrategia/e74-aba-em-andamento.md`, seções 2 e 3.
 *
 *  - **O id é do navegador** (R-a): gerado ao tocar em "Escrever" e guardado antes de a rede ser usada. O mesmo id enviado de novo devolve o pedido que já existe, sem escrever de novo; um id de
 *    outra marca nunca devolve nada dela.
 *  - **Um em andamento por tipo e marca** (R-d, decisão do Gustavo em 26/11/2026): o índice único parcial é a trava; o segundo pedido recebe o id do primeiro.
 *  - **A folga do teto é reservada quando o pedido nasce** (R-d): enquanto anda, ele conta no teto do teste (`cadastro-travas.ts`, `pedidosQueReservam`) e no teto do dia (`versoes.ts`,
 *    `conferirFolgaDoDia`). O que falha deixa de contar (R-o): a pessoa não paga pelo que não recebeu.
 *  - **A etapa** (R-e) é escrita por quem faz o trabalho (`gerarVersoes`), e cada escrita move o batimento (`atualizado_em`).
 *  - **A varredura** (seção 3.3) é o último recurso: o pedido sem batimento além do prazo vira pronto com o que já foi escrito ou falha (e só então a tela oferece "Tentar de novo").
 *
 * Este arquivo não importa `versoes.ts` (que o importa): o que precisa dos dois mora em `pedidos-estado.ts`.
 */
import { and, count, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

import {
  DIAS_DO_TEMPO_MEDIDO,
  ESTADOS_EM_ANDAMENTO,
  GUARDA_DO_TEMPO_TIPICO_MS,
  MINIMO_PARA_O_TEMPO_MEDIDO,
  PRAZO_SEM_BATIMENTO_MS,
  TEMPO_TIPICO_INICIAL_S,
  TIPOS_DE_PEDIDO,
  type EstadoEmAndamento,
  type TipoDePedido,
} from "@/config/pedidos";
import { db } from "@/db";
import { pedidosDeGeracao, versoesDoRoteiro, type PedidoDeGeracao } from "@/db/schema";
import { idDePedidoOuNulo } from "@/lib/id-do-pedido";
import { logger } from "@/lib/log";
import { textosPedidos } from "@/textos/pedidos";

export { idDePedidoOuNulo };

/** O que o pedido recusa, com a frase para a pessoa. `ja-em-andamento` traz o id do pedido que está andando (a tela leva até ele). */
export class ErroPedido extends Error {
  constructor(
    mensagem: string,
    readonly codigo: "ja-em-andamento" | "id-invalido",
    readonly emAndamentoId: string | null = null,
  ) {
    super(mensagem);
    this.name = "ErroPedido";
  }
}

/** O código técnico que a varredura grava no pedido que parou sem batimento: um "pronto" que chega depois ainda vale (a escrita terminou, a pessoa recebe). */
export const CODIGO_PARADO = "parado";
/** O pronto que a varredura fechou com as versões que já existiam. */
export const CODIGO_PRONTO_COM_O_QUE_HAVIA = "parou-no-meio";

const emAndamento = () => inArray(pedidosDeGeracao.estado, [...ESTADOS_EM_ANDAMENTO]);

function ehViolacaoDeUnico(erro: unknown): boolean {
  const e = erro as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function pedidoPorId(id: string): Promise<PedidoDeGeracao | null> {
  const [linha] = await db().select().from(pedidosDeGeracao).where(eq(pedidosDeGeracao.id, id));
  return linha ?? null;
}

/** O pedido desta marca com este id; nulo quando o id não vale ou é de outra marca (a outra marca nunca fica sabendo que o id existe). */
export async function pedidoDaMarca(clienteId: number, id: unknown): Promise<PedidoDeGeracao | null> {
  const valido = idDePedidoOuNulo(id);
  if (!valido) return null;
  const [linha] = await db()
    .select()
    .from(pedidosDeGeracao)
    .where(and(eq(pedidosDeGeracao.id, valido), eq(pedidosDeGeracao.clienteId, clienteId)));
  return linha ?? null;
}

/** O pedido deste tipo que esta marca tem andando agora (no máximo um, pelo índice único). */
export async function pedidoEmAndamento(clienteId: number, tipo: TipoDePedido): Promise<PedidoDeGeracao | null> {
  const [linha] = await db()
    .select()
    .from(pedidosDeGeracao)
    .where(and(eq(pedidosDeGeracao.clienteId, clienteId), eq(pedidosDeGeracao.tipo, tipo), emAndamento()))
    .limit(1);
  return linha ?? null;
}

export type NovoPedido = {
  id: string;
  clienteId: number;
  tipo: TipoDePedido;
  titulo: string;
  parametros: Record<string, unknown>;
  criadoPor?: string | null;
  refeitoDe?: string | null;
  /** Confere a folga do teto ANTES de o pedido existir (lança a recusa com a frase). Depois de criado, o pedido reserva a folga para si. */
  conferirFolga?: () => Promise<void>;
};

function repetido(existente: PedidoDeGeracao, novo: NovoPedido): { pedido: PedidoDeGeracao; novo: false } {
  // Um id que já existe em outra marca (ou de outro tipo) é um id que não vale aqui: nada dela volta.
  if (existente.clienteId !== novo.clienteId || existente.tipo !== novo.tipo) throw new ErroPedido(textosPedidos.idInvalido, "id-invalido");
  return { pedido: existente, novo: false };
}

/**
 * Cria o pedido (estado `lendo`), ou devolve o que já existe com o mesmo id (`novo: false`: quem chama NÃO escreve de novo). Com outro pedido do mesmo tipo andando na marca, recusa com
 * `ja-em-andamento` e o id dele, sem gastar nada. A corrida entre dois pedidos ao mesmo tempo cai no índice único e vira a mesma recusa (ou o mesmo pedido, se o id for o mesmo).
 */
export async function criarPedido(novo: NovoPedido): Promise<{ pedido: PedidoDeGeracao; novo: boolean }> {
  const id = idDePedidoOuNulo(novo.id);
  if (!id) throw new ErroPedido(textosPedidos.idInvalido, "id-invalido");
  const existente = await pedidoPorId(id);
  if (existente) return repetido(existente, novo);
  const andando = await pedidoEmAndamento(novo.clienteId, novo.tipo);
  if (andando) throw new ErroPedido(textosPedidos.jaEmAndamento[novo.tipo], "ja-em-andamento", andando.id);
  await novo.conferirFolga?.();
  try {
    const [linha] = await db()
      .insert(pedidosDeGeracao)
      .values({
        id,
        clienteId: novo.clienteId,
        tipo: novo.tipo,
        estado: "lendo",
        titulo: novo.titulo.trim().slice(0, 500) || textosPedidos.temaDoDia,
        parametros: novo.parametros,
        criadoPor: novo.criadoPor ?? null,
        refeitoDe: idDePedidoOuNulo(novo.refeitoDe),
      })
      .returning();
    return { pedido: linha, novo: true };
  } catch (erro) {
    if (!ehViolacaoDeUnico(erro)) throw erro;
    const mesmo = await pedidoPorId(id);
    if (mesmo) return repetido(mesmo, novo);
    const corrente = await pedidoEmAndamento(novo.clienteId, novo.tipo);
    if (corrente) throw new ErroPedido(textosPedidos.jaEmAndamento[novo.tipo], "ja-em-andamento", corrente.id);
    throw erro;
  }
}

export type EtapaDoPedido = {
  estado: EstadoEmAndamento;
  etapaN?: number | null;
  titulo?: string;
  resultado?: { tipo: string; id: string };
};

/**
 * Grava a etapa e move o batimento. Só mexe em pedido que ainda anda (um pedido que a varredura já fechou não volta a andar). Nunca derruba quem escreve: a etapa é para a tela, e a escrita
 * (já paga) continua mesmo se esta gravação falhar.
 */
export async function marcarEtapa(pedidoId: string, etapa: EtapaDoPedido): Promise<void> {
  try {
    await db()
      .update(pedidosDeGeracao)
      .set({
        estado: etapa.estado,
        etapaN: etapa.etapaN ?? null,
        ...(etapa.titulo ? { titulo: etapa.titulo.trim().slice(0, 500) } : {}),
        ...(etapa.resultado ? { resultadoTipo: etapa.resultado.tipo, resultadoId: etapa.resultado.id } : {}),
        atualizadoEm: new Date(),
      })
      .where(and(eq(pedidosDeGeracao.id, pedidoId), emAndamento()));
  } catch (erro) {
    logger.warn({ err: erro, pedidoId }, "nao foi possivel gravar a etapa do pedido");
  }
}

/**
 * O pedido ficou pronto. Vale também para o que a varredura deu como parado (`CODIGO_PARADO`): a escrita terminou depois do prazo, e a pessoa recebe o que pagou em vez de uma falha. Nunca
 * derruba quem escreveu (a escrita já está gravada; sem esta linha, a varredura fecha o pedido com o que há).
 */
export async function terminarPedido(pedidoId: string, resultado: { tipo: string; id: string }): Promise<void> {
  const agora = new Date();
  try {
    await db()
      .update(pedidosDeGeracao)
      .set({ estado: "pronto", etapaN: null, resultadoTipo: resultado.tipo, resultadoId: resultado.id, motivo: null, codigoDoErro: null, terminouEm: agora, atualizadoEm: agora })
      .where(and(eq(pedidosDeGeracao.id, pedidoId), or(emAndamento(), and(eq(pedidosDeGeracao.estado, "falhou"), eq(pedidosDeGeracao.codigoDoErro, CODIGO_PARADO)))));
  } catch (erro) {
    logger.warn({ err: erro, pedidoId }, "nao foi possivel marcar o pedido como pronto");
  }
}

/** O pedido falhou: a frase para a pessoa (a do erro, quando ele tem uma; senão a de que não conta no limite) e o código para o admin. A folga reservada volta (o pedido deixa de contar). */
export async function falharPedido(pedidoId: string, falha: { tipo: TipoDePedido; codigo: string; motivo?: string | null }): Promise<void> {
  const agora = new Date();
  try {
    await db()
      .update(pedidosDeGeracao)
      .set({ estado: "falhou", etapaN: null, motivo: falha.motivo || textosPedidos.falhou[falha.tipo], codigoDoErro: falha.codigo.slice(0, 200), terminouEm: agora, atualizadoEm: agora })
      .where(and(eq(pedidosDeGeracao.id, pedidoId), emAndamento()));
  } catch (erro) {
    logger.warn({ err: erro, pedidoId }, "nao foi possivel marcar o pedido como falho");
  }
}

export type ResumoDaVarredura = { parados: number; prontosComOQueHavia: number; falhos: number };

/**
 * A varredura de minuto em minuto (seção 3.3): o pedido em andamento sem batimento além do prazo do tipo (`PRAZO_SEM_BATIMENTO_MS`) foi abandonado (o servidor reiniciou no meio, por exemplo).
 * O roteiro que já tinha versões gravadas vira pronto com o que existe (o comportamento de `gerarVersoes` quando uma versão do meio falha); o resto falha com a frase de que não conta no limite.
 * A troca só vale se o batimento não mudou desde a leitura: quem ainda escreve ganha a corrida. Escopo global (todas as marcas); o resumo tem só números.
 */
export async function varrerPedidosParados(agora = new Date()): Promise<ResumoDaVarredura> {
  const menorPrazo = Math.min(...TIPOS_DE_PEDIDO.map((t) => PRAZO_SEM_BATIMENTO_MS[t]));
  const candidatos = await db()
    .select({
      id: pedidosDeGeracao.id,
      clienteId: pedidosDeGeracao.clienteId,
      tipo: pedidosDeGeracao.tipo,
      estado: pedidosDeGeracao.estado,
      resultadoTipo: pedidosDeGeracao.resultadoTipo,
      resultadoId: pedidosDeGeracao.resultadoId,
      atualizadoEm: pedidosDeGeracao.atualizadoEm,
    })
    .from(pedidosDeGeracao)
    .where(and(emAndamento(), lt(pedidosDeGeracao.atualizadoEm, new Date(agora.getTime() - menorPrazo))));

  const resumo: ResumoDaVarredura = { parados: 0, prontosComOQueHavia: 0, falhos: 0 };
  for (const c of candidatos) {
    const prazo = PRAZO_SEM_BATIMENTO_MS[c.tipo] ?? menorPrazo;
    if (agora.getTime() - c.atualizadoEm.getTime() < prazo) continue;
    resumo.parados += 1;
    const mesmoBatimento = and(eq(pedidosDeGeracao.id, c.id), eq(pedidosDeGeracao.estado, c.estado), eq(pedidosDeGeracao.atualizadoEm, c.atualizadoEm));

    let versoes = 0;
    if (c.tipo === "roteiro" && c.resultadoTipo === "versoes" && c.resultadoId) {
      const [{ total }] = await db()
        .select({ total: count() })
        .from(versoesDoRoteiro)
        .where(and(eq(versoesDoRoteiro.clienteId, c.clienteId), eq(versoesDoRoteiro.grupo, c.resultadoId)));
      versoes = total;
    }
    if (versoes > 0) {
      const [feito] = await db()
        .update(pedidosDeGeracao)
        .set({ estado: "pronto", etapaN: null, codigoDoErro: CODIGO_PRONTO_COM_O_QUE_HAVIA, terminouEm: agora, atualizadoEm: agora })
        .where(mesmoBatimento)
        .returning({ id: pedidosDeGeracao.id });
      if (feito) resumo.prontosComOQueHavia += 1;
      continue;
    }
    const [falho] = await db()
      .update(pedidosDeGeracao)
      .set({ estado: "falhou", etapaN: null, motivo: textosPedidos.falhou[c.tipo], codigoDoErro: CODIGO_PARADO, terminouEm: agora, atualizadoEm: agora })
      .where(mesmoBatimento)
      .returning({ id: pedidosDeGeracao.id });
    if (falho) resumo.falhos += 1;
  }
  return resumo;
}

/** Quantos pedidos estão andando agora, em todas as marcas: o `deploy/deploy.sh` faz a mesma conta em SQL antes de recriar o app e o worker (R-n). */
export async function pedidosAndandoAgora(): Promise<number> {
  const [{ total }] = await db().select({ total: count() }).from(pedidosDeGeracao).where(emAndamento());
  return total;
}

export type TempoTipico = { deS: number; ateS: number };

const tempoGuardado = new Map<TipoDePedido, { valor: TempoTipico; vence: number }>();

/** Só para os testes: esquece o tempo típico guardado. */
export function esquecerTempoTipico(): void {
  tempoGuardado.clear();
}

/**
 * "Costuma levar de X a Y" (seção 5): o 20º e o 80º percentil do tempo real dos pedidos prontos do tipo nos últimos 30 dias, de todas as marcas (o número é do produto, nunca de uma marca:
 * circula padrão, nunca conteúdo). Com menos de 20 pedidos medidos, os números de `TEMPO_TIPICO_INICIAL_S`. Guardado por 10 minutos; uma falha de leitura volta aos números iniciais.
 */
export async function tempoTipico(tipo: TipoDePedido, agora = new Date()): Promise<TempoTipico> {
  const guardado = tempoGuardado.get(tipo);
  if (guardado && guardado.vence > agora.getTime()) return guardado.valor;
  const inicial = { deS: TEMPO_TIPICO_INICIAL_S[tipo].de, ateS: TEMPO_TIPICO_INICIAL_S[tipo].ate };
  let valor = inicial;
  try {
    const duracao = sql`extract(epoch from (${pedidosDeGeracao.terminouEm} - ${pedidosDeGeracao.iniciadoEm}))`;
    const [linha] = await db()
      .select({
        total: count(),
        p20: sql<string | null>`percentile_cont(0.2) within group (order by ${duracao})`,
        p80: sql<string | null>`percentile_cont(0.8) within group (order by ${duracao})`,
      })
      .from(pedidosDeGeracao)
      .where(
        and(
          eq(pedidosDeGeracao.tipo, tipo),
          eq(pedidosDeGeracao.estado, "pronto"),
          isNull(pedidosDeGeracao.codigoDoErro),
          gte(pedidosDeGeracao.terminouEm, new Date(agora.getTime() - DIAS_DO_TEMPO_MEDIDO * 86_400_000)),
        ),
      );
    if (linha && linha.total >= MINIMO_PARA_O_TEMPO_MEDIDO && linha.p20 !== null && linha.p80 !== null) {
      const de = Math.max(1, Math.round(Number(linha.p20)));
      valor = { deS: de, ateS: Math.max(de, Math.round(Number(linha.p80))) };
    }
  } catch (erro) {
    logger.warn({ err: erro, tipo }, "nao foi possivel medir o tempo tipico dos pedidos");
  }
  tempoGuardado.set(tipo, { valor, vence: agora.getTime() + GUARDA_DO_TEMPO_TIPICO_MS });
  return valor;
}
