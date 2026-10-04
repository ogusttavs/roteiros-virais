"use server";

import type { SistemaInstalado } from "@/db/schema";
import { logger } from "@/lib/log";
import { exigirForaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { ErroAcessoNegado } from "@/servicos/clientes";
import { adiarPedidoDePush, apagarInscricaoDaPessoa, ErroInscricaoPush, registrarInscricaoPush } from "@/servicos/push";

function textoNaoVazio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

/**
 * O aviso de manhã por push (E48 PR 2). O usuário sempre vem da sessão, nunca de um parâmetro (mesmo padrão de `instalar-acoes.ts`).
 * Devolve `true` quando a inscrição ficou registrada; uma inscrição inválida (endereço que não é https, chaves vazias) volta `false`, sem lançar.
 */
export async function registrarInscricaoPushAction(dados: unknown, sistema: unknown): Promise<boolean> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  // Os argumentos vêm do navegador: só strings não vazias valem (qualquer outra coisa devolve `false`, sem lançar).
  const entrada = dados as { endpoint?: unknown; p256dh?: unknown; auth?: unknown } | null;
  if (
    typeof entrada !== "object" ||
    entrada === null ||
    !textoNaoVazio(entrada.endpoint) ||
    !textoNaoVazio(entrada.p256dh) ||
    !textoNaoVazio(entrada.auth) ||
    !textoNaoVazio(sistema)
  ) {
    return false;
  }
  // O aviso é do celular: qualquer coisa que não seja iphone ou android vira computador (e nunca chega aqui pela tela, que só pede no celular).
  const valido: SistemaInstalado = sistema === "iphone" || sistema === "android" ? sistema : "computador";
  try {
    await registrarInscricaoPush(sessao.user.id, { endpoint: entrada.endpoint, p256dh: entrada.p256dh, auth: entrada.auth }, valido);
    return true;
  } catch (erro) {
    if (erro instanceof ErroInscricaoPush) return false;
    throw erro;
  }
}

/** A pessoa desliga o aviso neste aparelho (só apaga uma inscrição dela). */
export async function apagarInscricaoPushAction(endpoint: unknown): Promise<void> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  if (!textoNaoVazio(endpoint)) return;
  await apagarInscricaoDaPessoa(sessao.user.id, endpoint);
}

/** "Agora não" no pedido de permissão: a folha não volta por sete dias, em nenhum aparelho da pessoa. */
export async function adiarPedidoDePushAction(): Promise<void> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  await adiarPedidoDePush(sessao.user.id);
}

/**
 * O aparelho não conseguiu ligar o aviso (item 0d): só grava no log, no nível de aviso, com o id da pessoa, o passo em que falhou e o motivo do navegador.
 * Nunca o endereço da inscrição nem uma chave. Não lança: quem chama já está mostrando o erro.
 */
const ULTIMA_FALHA_POR_PESSOA = new Map<string, number>();
/** Um aviso por pessoa por minuto: uma pessoa logada não enche o log repetindo a chamada. */
const INTERVALO_DA_FALHA_MS = 60_000;

export async function registrarFalhaDePushAction(motivo: unknown, etapa: unknown, sistema: unknown): Promise<void> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
  if (!sessao) return;
  const agora = Date.now();
  const antes = ULTIMA_FALHA_POR_PESSOA.get(sessao.user.id);
  if (antes !== undefined && agora - antes < INTERVALO_DA_FALHA_MS) return;
  ULTIMA_FALHA_POR_PESSOA.set(sessao.user.id, agora);
  // O mapa não cresce sem fim: passando de mil pessoas, esquece as antigas.
  if (ULTIMA_FALHA_POR_PESSOA.size > 1000) {
    for (const [id, quando] of ULTIMA_FALHA_POR_PESSOA) if (agora - quando >= INTERVALO_DA_FALHA_MS) ULTIMA_FALHA_POR_PESSOA.delete(id);
  }
  const limpo = (valor: unknown, tamanho: number) => (typeof valor === "string" ? valor.replace(/[\r\n]+/g, " ").slice(0, tamanho) : "?");
  logger.warn({ usuarioId: sessao.user.id, etapa: limpo(etapa, 20), sistema: limpo(sistema, 20), motivo: limpo(motivo, 300) }, "push: o aparelho nao conseguiu ligar o aviso");
}
