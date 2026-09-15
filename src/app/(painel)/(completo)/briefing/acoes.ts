"use server";

import { desativarRegra, reativarRegra } from "@/servicos/aprendizado";
import { avaliarResposta, salvarRascunho } from "@/servicos/briefing";
import { clienteDaSessaoAtual } from "@/servicos/clientes";

/**
 * Edicao do briefing vivo (brief-frontend.md, 6.8). O cliente sempre vem da
 * sessao, nunca de um parametro; mesma defesa de /comecar/acoes.ts.
 */

export async function salvarRascunhoAction(perguntaId: string, resposta: string) {
  const cliente = await clienteDaSessaoAtual();
  await salvarRascunho(cliente.id, perguntaId, resposta);
}

export async function avaliarRespostaAction(perguntaId: string, resposta: string) {
  const cliente = await clienteDaSessaoAtual();
  return avaliarResposta(cliente.id, perguntaId, resposta);
}

/** "O que a gente aprendeu com você" (E27 parte 2, item 4): "Não é bem assim" e "Desfazer". */
export async function desativarRegraAction(regraId: number): Promise<void> {
  const cliente = await clienteDaSessaoAtual();
  await desativarRegra(cliente.id, regraId);
}

export async function reativarRegraAction(regraId: number): Promise<void> {
  const cliente = await clienteDaSessaoAtual();
  await reativarRegra(cliente.id, regraId);
}
