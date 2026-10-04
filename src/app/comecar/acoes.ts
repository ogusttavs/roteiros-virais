"use server";

import type { ResultadoAcao } from "@/lib/resultado-acao";
import { exigirForaDoVerComo, recusaDoVerComo } from "@/lib/ver-como";
import { avaliarResposta, salvarRascunho } from "@/servicos/briefing";
import { clienteDaSessaoAtual, salvarDadosFixosComPedido } from "@/servicos/clientes";
import { ErroLimiteDeSetores } from "@/servicos/ramos";
import { textosRamo } from "@/textos/ramo";

/**
 * As tres acoes do /comecar (brief-frontend.md, 6.2). Nenhuma recebe um
 * clienteId de fora: o cliente sempre vem da sessao (clienteDaSessaoAtual),
 * entao nao existe caminho por aqui para ler ou gravar o briefing de outro
 * cliente (isolamento no nivel de rota, plano de execucao etapa 5).
 */

/**
 * E45 PR 2: o teto de setores novos por dia vira a frase na tela (`ResultadoAcao`), não um erro lançado: em produção o Next esconde a
 * mensagem de uma exceção, e a pessoa veria o "confira os campos" genérico com o formulário certo. Qualquer outro erro continua sendo lançado.
 * Nada do `Cliente` volta ao navegador; volta só se o teto segurou o palpite do ramo provisório (o pedido vai aberto e a tela não promete o ramo).
 */
export async function salvarDadosFixosAction(dadosBrutos: unknown): Promise<ResultadoAcao<{ limiteDeRamosNovos: boolean }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const cliente = await clienteDaSessaoAtual();
  try {
    const { limiteDeRamosNovos } = await salvarDadosFixosComPedido(cliente.id, dadosBrutos);
    return { ok: true, dado: { limiteDeRamosNovos } };
  } catch (erro) {
    if (erro instanceof ErroLimiteDeSetores) return { ok: false, erro: textosRamo.limiteDeRamosNovos };
    throw erro;
  }
}

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
