/**
 * As travas da marca de cadastro próprio (E63, PR 1): e-mail confirmado e o teto do teste. Só valem para a marca que tem linha em `cadastros_proprios`; a conta que o admin criou nunca
 * tem, e para ela nada muda. O portão (`lib/portao-cobranca.ts`) chama `barreiraDoCadastro` antes de qualquer ação ou rota que gasta IA.
 *
 * - **E-mail:** o da dona da marca precisa estar confirmado (`user.emailVerified`), com ou sem cobrança ligada.
 * - **Teto do teste** (`TETO_DO_TESTE`): vale para a marca sem cortesia e sem assinatura `active` (paga). O teste de 7 dias sem cartão (`trialing`) ainda é teste. A IA conta
 *   `geracoes_ia` da marca mais a transcrição das edições (a IA da edição já está em `geracoes_ia`).
 * - **Ramos novos:** a pesquisa de setor novo (Apify e YouTube) roda sozinha só para `ramosNovosPorDia` ramos por dia vindos de cadastro próprio.
 */
import { and, count, eq, gt, inArray, ne, sql } from "drizzle-orm";

import { LIMITES_DO_CADASTRO, TETO_DO_TESTE } from "@/config/cadastro";
import { ESTADOS_EM_ANDAMENTO } from "@/config/pedidos";
import { db } from "@/db";
import { cadastrosProprios, carrosseis, edicoes, geracoesIA, pedidosDeGeracao, roteiros, setoresDeCadastro, user } from "@/db/schema";

import { assinaturaVale, assinaturasDaMarca } from "./assinatura";

export type GastoQueConta = "roteiro" | "edicao";
export type Barreira = { tipo: "email" } | { tipo: "teto"; qual: "roteiros" | "edicoes" | "uso" };

/** A marca nasceu do cadastro sozinho? */
export async function marcaEhDeCadastroProprio(clienteId: number): Promise<boolean> {
  const [linha] = await db().select({ usuarioId: cadastrosProprios.usuarioId }).from(cadastrosProprios).where(eq(cadastrosProprios.clienteId, clienteId));
  return Boolean(linha);
}

/** Quanto a marca já gastou de IA, em dólar: gerações registradas mais a transcrição das edições. */
export async function gastoDeIaDaMarcaUsd(clienteId: number): Promise<number> {
  const [geracoes] = await db()
    .select({ total: sql<string>`coalesce(sum(${geracoesIA.custoUsd}), 0)` })
    .from(geracoesIA)
    .where(eq(geracoesIA.clienteId, clienteId));
  const [transcricoes] = await db()
    .select({ total: sql<string>`coalesce(sum(${edicoes.custoTranscricaoUsd}), 0)` })
    .from(edicoes)
    .where(eq(edicoes.clienteId, clienteId));
  return Number(geracoes?.total ?? 0) + Number(transcricoes?.total ?? 0);
}

/**
 * E74 PR 2a: os pedidos de roteiro e de carrossel que estão sendo escritos agora reservam a folga do teto (decisão do Gustavo em 26/11/2026): sem isso, três tipos ao mesmo tempo passariam juntos
 * pela mesma conta. `semOPedido` tira da conta o próprio pedido que está sendo pedido de novo (o mesmo id não conta contra si mesmo). O que falhou deixa de contar: a falha não gasta o limite.
 */
export async function pedidosQueReservam(clienteId: number, semOPedido?: string): Promise<number> {
  const [{ total }] = await db()
    .select({ total: count() })
    .from(pedidosDeGeracao)
    .where(
      and(
        eq(pedidosDeGeracao.clienteId, clienteId),
        inArray(pedidosDeGeracao.estado, [...ESTADOS_EM_ANDAMENTO]),
        semOPedido ? ne(pedidosDeGeracao.id, semOPedido) : undefined,
      ),
    );
  return total;
}

/**
 * Esta marca está barrada agora? `null` para quem não é de cadastro próprio, ou é e está em dia. O e-mail vem antes do teto. `gasto` diz que ação está sendo pedida: criar roteiro
 * confere o teto de roteiros, mandar vídeo para editar confere o de edições; o teto de IA vale para toda ação.
 */
export async function barreiraDoCadastro(entrada: { clienteId: number; cortesia: boolean; gasto?: GastoQueConta; agora?: Date; semOPedido?: string }): Promise<Barreira | null> {
  const agora = entrada.agora ?? new Date();
  const [cadastro] = await db()
    .select({ confirmado: user.emailVerified })
    .from(cadastrosProprios)
    .innerJoin(user, eq(user.id, cadastrosProprios.usuarioId))
    .where(eq(cadastrosProprios.clienteId, entrada.clienteId));
  if (!cadastro) return null;
  if (!cadastro.confirmado) return { tipo: "email" };

  if (entrada.cortesia) return null;
  const assinaturas = await assinaturasDaMarca(entrada.clienteId);
  if (assinaturas.some((a) => a.status === "active" && assinaturaVale(a, agora))) return null;

  if (entrada.gasto === "roteiro") {
    const [{ total: dosRoteiros }] = await db().select({ total: count() }).from(roteiros).where(eq(roteiros.clienteId, entrada.clienteId));
    // E65: um carrossel conta como um roteiro no teto do teste.
    const [{ total: dosCarrosseis }] = await db().select({ total: count() }).from(carrosseis).where(eq(carrosseis.clienteId, entrada.clienteId));
    // E74 PR 2a: o que está sendo escrito agora já ocupa o lugar dele.
    const reservados = await pedidosQueReservam(entrada.clienteId, entrada.semOPedido);
    if (dosRoteiros + dosCarrosseis + reservados >= TETO_DO_TESTE.roteiros) return { tipo: "teto", qual: "roteiros" };
  }
  if (entrada.gasto === "edicao") {
    const [{ total }] = await db()
      .select({ total: count() })
      .from(edicoes)
      .where(and(eq(edicoes.clienteId, entrada.clienteId), sql`${edicoes.estado} <> 'falhou'`));
    if (total >= TETO_DO_TESTE.edicoes) return { tipo: "teto", qual: "edicoes" };
  }
  if ((await gastoDeIaDaMarcaUsd(entrada.clienteId)) >= TETO_DO_TESTE.iaUsd) return { tipo: "teto", qual: "uso" };
  return null;
}

/** Quantos setores novos nasceram nas últimas 24 horas por cadastro próprio. */
export async function setoresNovosDeCadastroHoje(agora: Date = new Date()): Promise<number> {
  const [{ total }] = await db()
    .select({ total: count() })
    .from(setoresDeCadastro)
    .where(gt(setoresDeCadastro.criadoEm, new Date(agora.getTime() - 24 * 60 * 60 * 1000)));
  return total;
}

/** Ainda cabe um ramo novo pesquisado sozinho hoje? */
export async function cabeRamoNovoDeCadastro(agora: Date = new Date()): Promise<boolean> {
  return (await setoresNovosDeCadastroHoje(agora)) < LIMITES_DO_CADASTRO.ramosNovosPorDia;
}

/** Anota que este setor nasceu de um cadastro próprio (conta para o teto do dia). */
export async function anotarSetorDeCadastro(nichoId: number): Promise<void> {
  await db().insert(setoresDeCadastro).values({ nichoId }).onConflictDoNothing();
}
