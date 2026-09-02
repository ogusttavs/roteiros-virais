"use server";

import { avaliarResposta, salvarRascunho } from "@/servicos/briefing";
import { clienteDaSessaoAtual, salvarDadosFixos } from "@/servicos/clientes";

/**
 * As tres acoes do /comecar (brief-frontend.md, 6.2). Nenhuma recebe um
 * clienteId de fora: o cliente sempre vem da sessao (clienteDaSessaoAtual),
 * entao nao existe caminho por aqui para ler ou gravar o briefing de outro
 * cliente (isolamento no nivel de rota, plano de execucao etapa 5).
 */

export async function salvarDadosFixosAction(dadosBrutos: unknown) {
  const cliente = await clienteDaSessaoAtual();
  return salvarDadosFixos(cliente.id, dadosBrutos);
}

export async function salvarRascunhoAction(perguntaId: string, resposta: string) {
  const cliente = await clienteDaSessaoAtual();
  await salvarRascunho(cliente.id, perguntaId, resposta);
}

export async function avaliarRespostaAction(perguntaId: string, resposta: string) {
  const cliente = await clienteDaSessaoAtual();
  return avaliarResposta(cliente.id, perguntaId, resposta);
}
