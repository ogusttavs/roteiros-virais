"use server";

import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado, clienteDaSessaoAtual } from "@/servicos/clientes";
import {
  apagarRascunhoTemaLivre,
  avaliarTema,
  salvarRascunhoTemaLivre,
  type ResultadoAvaliarTema,
} from "@/servicos/temas";

/**
 * `/hoje/tema-livre` (V5b, item 2): o rascunho salva sozinho, sem bloquear a
 * digitação; falhou, tenta de novo na próxima tecla, sem aviso (o chamador
 * no client trata a rejeição em silêncio).
 */
export async function salvarRascunhoAction(texto: string): Promise<void> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  await salvarRascunhoTemaLivre(sessao.user.id, cliente.id, texto);
}

/**
 * O cliente sempre vem da sessão, nunca de um parâmetro. O rascunho some
 * quando a avaliação termina com sucesso; continua se der erro.
 */
export async function avaliarTemaAction(texto: string): Promise<ResultadoAvaliarTema> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  const resultado = await avaliarTema(cliente, texto);
  await apagarRascunhoTemaLivre(sessao.user.id, cliente.id);
  return resultado;
}
