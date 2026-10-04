"use server";

import { exigirForaDoVerComo } from "@/lib/ver-como";
import { desativarRegra, reativarRegra } from "@/servicos/aprendizado";
import { avaliarResposta, salvarRascunho } from "@/servicos/briefing";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { confirmarItem, corrigirItem, desfazerTirarItem, tirarItem } from "@/servicos/contexto-marca";

/**
 * Edicao do briefing vivo (brief-frontend.md, 6.8). O cliente sempre vem da
 * sessao, nunca de um parametro; mesma defesa de /comecar/acoes.ts.
 */

export async function salvarRascunhoAction(perguntaId: string, resposta: string, transcricaoBruta?: string) {
  await exigirForaDoVerComo();
  const cliente = await clienteDaSessaoAtual();
  await salvarRascunho(cliente.id, perguntaId, resposta, cliente.tipo, transcricaoBruta);
}

export async function avaliarRespostaAction(perguntaId: string, resposta: string) {
  await exigirForaDoVerComo();
  const cliente = await clienteDaSessaoAtual();
  return avaliarResposta(cliente.id, perguntaId, resposta, cliente.tipo);
}

/** "O que a gente aprendeu com você" (E27 parte 2, item 4): "Não é bem assim" e "Desfazer". */
export async function desativarRegraAction(regraId: number): Promise<void> {
  await exigirForaDoVerComo();
  const cliente = await clienteDaSessaoAtual();
  await desativarRegra(cliente.id, regraId);
}

export async function reativarRegraAction(regraId: number): Promise<void> {
  await exigirForaDoVerComo();
  const cliente = await clienteDaSessaoAtual();
  await reativarRegra(cliente.id, regraId);
}

/**
 * "O que a IA tirou das suas redes e do seu site" (E38 PR 2): confirmar, corrigir, tirar e desfazer
 * um item. A marca vem da sessão (nunca de um parâmetro, e o serviço confere `id` e `clienteId`
 * juntos no `WHERE`): um id de item de outra marca nunca vale.
 */
export async function confirmarItemContextoAction(itemId: number, textoVisto: string): Promise<"confirmado" | "mudou"> {
  await exigirForaDoVerComo();
  const cliente = await clienteDaSessaoAtual();
  return confirmarItem(cliente.id, itemId, textoVisto);
}

export async function corrigirItemContextoAction(itemId: number, texto: string): Promise<void> {
  await exigirForaDoVerComo();
  const cliente = await clienteDaSessaoAtual();
  await corrigirItem(cliente.id, itemId, texto);
}

export async function tirarItemContextoAction(itemId: number): Promise<void> {
  await exigirForaDoVerComo();
  const cliente = await clienteDaSessaoAtual();
  await tirarItem(cliente.id, itemId);
}

export async function desfazerTirarItemContextoAction(itemId: number): Promise<void> {
  await exigirForaDoVerComo();
  const cliente = await clienteDaSessaoAtual();
  await desfazerTirarItem(cliente.id, itemId);
}
