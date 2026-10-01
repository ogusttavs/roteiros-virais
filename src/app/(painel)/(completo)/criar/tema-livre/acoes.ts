"use server";

import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado, clienteDaSessaoAtual } from "@/servicos/clientes";
import { avaliarTema, salvarRascunhoTemaLivre, type ResultadoAvaliarTema } from "@/servicos/temas";

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
 * O cliente sempre vem da sessão, nunca de um parâmetro. O rascunho não
 * some mais quando a avaliação termina com sucesso (item 0 da V6, resto da
 * revisão do PR #50): quem recebe uma nota abaixo da meta, sai e volta
 * precisa achar o texto lá. Só some quando a pessoa avalia outro assunto
 * ou apaga o campo (`salvarRascunhoTemaLivre`).
 */
export async function avaliarTemaAction(texto: string): Promise<ResultadoAvaliarTema> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  return avaliarTema(cliente, texto);
}
