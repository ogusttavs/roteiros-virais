"use server";

import type { Objetivo } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado, clienteDaSessaoAtual, garantirMembroDaMarca } from "@/servicos/clientes";
import {
  aceitar,
  criarPlano,
  lerAgendaDeTexto,
  pular,
  type DiaAgenda,
  type ItemPlano,
  type ResultadoLerAgenda,
} from "@/servicos/plano";
import { ErroRoteiro, validarFormato } from "@/servicos/roteiro";

/**
 * "Colar a agenda" (V9b, item 1): separa o texto (digitado ou transcrito
 * pela mesma rota do momento) em dias, com a data de cada um já resolvida
 * por código. A pessoa confere a lista antes de confirmar (`criarPlanoAction`).
 * V9d, item 4: `diasNaoEntendidos` vai junto, para a folha mostrar "não
 * entendi este dia" em vez de descartar em silêncio.
 */
export async function lerAgendaAction(texto: string): Promise<ResultadoLerAgenda> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  return lerAgendaDeTexto(texto);
}

/**
 * Confirma a lista revisada e cria o plano (item 2): a marca sempre vem da
 * sessão, nunca de um parâmetro, mesmo padrão do resto do painel.
 */
export async function criarPlanoAction(dias: DiaAgenda[]): Promise<ItemPlano[]> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  return criarPlano(cliente, dias);
}

export type DadosAceitarPlano = {
  onde: string;
  oQueEstaAcontecendo: string;
  oQueDaParaMostrar: string;
  objetivo: Objetivo;
  /**
   * V9c, item 1: o que a pessoa escolheu no controle segmentado da folha; reels se ausente. Chega
   * como texto livre do navegador (V9d, item 2): `validarFormato` confere antes de chegar ao banco.
   */
  formato?: string;
  marcaId?: number;
};

/**
 * "Escrever o roteiro" num item do plano (item 3): a folha "Gravar agora"
 * pré-preenchida pode ter sido editada, então os campos vêm da folha, não
 * direto do que `planejarDia` sugeriu. Confere `garantirMembroDaMarca`
 * antes de gerar, mesmo isolamento do momento (V9a, item 4).
 */
export async function aceitarPlanoAction(itemId: number, dados: DadosAceitarPlano): Promise<{ id: number }> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }

  const onde = dados.onde.trim();
  const oQueEstaAcontecendo = dados.oQueEstaAcontecendo.trim();
  const oQueDaParaMostrar = dados.oQueDaParaMostrar.trim();
  if (!onde || !oQueEstaAcontecendo || !oQueDaParaMostrar) {
    throw new ErroRoteiro("conte onde voce esta, o que esta acontecendo e o que da para mostrar.");
  }

  if (dados.marcaId !== undefined) {
    await garantirMembroDaMarca(sessao.user.id, dados.marcaId);
  }

  const cliente = await clienteDaSessaoAtual();
  const roteiro = await aceitar(itemId, cliente, {
    onde,
    oQueEstaAcontecendo,
    oQueDaParaMostrar,
    objetivo: dados.objetivo,
    formato: validarFormato(dados.formato),
    marcaId: dados.marcaId,
  });
  return { id: roteiro.id };
}

/** "Pular" um item do plano (item 3): some do bloco, sem gerar roteiro. */
export async function pularPlanoAction(itemId: number): Promise<void> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  await pular(itemId, cliente.id);
}
