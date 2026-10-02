"use server";

import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado, clienteDaSessaoAtual } from "@/servicos/clientes";
import { noticiaPorId } from "@/servicos/noticias";
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
 *
 * E43: `noticiaId` presente quando o tema nasceu de "Criar vídeo com esta
 * notícia". A notícia é resolvida aqui, escopada pelo setor do cliente, nunca
 * confiando num id de outro setor vindo do client.
 */
export async function avaliarTemaAction(texto: string, noticiaId?: number): Promise<ResultadoAvaliarTema> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  const noticia = noticiaId && cliente.nichoId ? await noticiaPorId(noticiaId, cliente.nichoId) : null;
  return avaliarTema(cliente, texto, noticia ? { titulo: noticia.titulo, resumo: noticia.resumo, angulo: noticia.angulo } : undefined);
}
