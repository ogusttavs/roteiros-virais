"use server";

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
