"use server";

import { exigirForaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { clienteDaSessaoAtual, ErroAcessoNegado, salvarRedePrincipal } from "@/servicos/clientes";
import { roteiroMaisRecenteDesde } from "@/servicos/roteiro";
import { grupoEmAberto } from "@/servicos/versoes";

/**
 * A rede principal da marca (V12, item 3a): trocável a qualquer hora pelo
 * chip na porta Reels, mesma sessão sempre resolvendo a marca, nunca um
 * `clienteId` vindo do navegador.
 */
export async function salvarRedePrincipalAction(rede: string): Promise<void> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  await salvarRedePrincipal(cliente.id, rede);
}

/**
 * R1, item 0c: chamada pela tela de espera quando a geração do roteiro parece ter caído por
 * rede. `desdeMs` é o relógio do aparelho no instante em que a espera começou; `MARGEM_MS`
 * absorve o desencontro normal entre o relógio do aparelho e o do servidor, para não perder um
 * roteiro que de fato terminou (perder por alguns segundos de margem é inofensivo: o próximo
 * roteiro do dia, se existir, é sempre mais recente que a margem).
 */
const MARGEM_RELOGIO_MS = 15_000;

export async function roteiroRecenteDesdeAction(desdeMs: number): Promise<{ id: number } | null> {
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  return roteiroMaisRecenteDesde(cliente.id, new Date(desdeMs - MARGEM_RELOGIO_MS));
}

/**
 * E26 4b: a mesma recuperação, para as versões. A geração das três grava cada versão assim que fica pronta, e a resposta que se perde na rede não perde o que foi escrito: o grupo mais
 * novo desde o início da espera, se já ficou pronto, é para onde a pessoa vai. Um grupo que o servidor ainda está escrevendo não vale: a pessoa cairia numa comparação com uma ou duas
 * versões e as outras só apareceriam se ela saísse e voltasse (o aviso de "olhe em Hoje" cobre esse caso, e o cartão aparece lá quando as três ficam prontas).
 */
export async function grupoRecenteDesdeAction(desdeMs: number): Promise<{ grupo: string } | null> {
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  const maisNovo = await grupoEmAberto(cliente.id);
  return maisNovo && !maisNovo.emEscrita && maisNovo.inicio.getTime() >= desdeMs - MARGEM_RELOGIO_MS ? { grupo: maisNovo.grupo } : null;
}

