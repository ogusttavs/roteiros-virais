"use server";

import { exigirForaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { noticiaDoAssuntoComoPontoDePartida, noticiaDoAssuntoDaMarca } from "@/servicos/assuntos";
import { ErroAcessoNegado, clienteDaSessaoAtual } from "@/servicos/clientes";
import { noticiaPorId } from "@/servicos/noticias";
import { avaliarTema, salvarRascunhoTemaLivre, type ResultadoAvaliarTema } from "@/servicos/temas";

/**
 * `/hoje/tema-livre` (V5b, item 2): o rascunho salva sozinho, sem bloquear a
 * digitação; falhou, tenta de novo na próxima tecla, sem aviso (o chamador
 * no client trata a rejeição em silêncio).
 */
export async function salvarRascunhoAction(texto: string): Promise<void> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
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
 *
 * E55 PR 2b: `assuntoEmAlta` é a chave do assunto em alta trazido para o ramo (o Tema livre
 * `?alta=`); `tendenciasQueTocamOTema` só o aceita se ele está na lista de agora e não é delicado.
 */
export async function avaliarTemaAction(texto: string, noticiaId?: number, assuntoEmAlta?: string, noticiaAssuntoId?: number): Promise<ResultadoAvaliarTema> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  const noticia = noticiaId && cliente.nichoId ? await noticiaPorId(noticiaId, cliente.nichoId) : null;
  // E53 (parte 3): a notícia de um assunto DESTA marca (a de outra nunca vem): o título e o resumo nosso, como a do setor.
  const noticiaDoAssunto = !noticia && noticiaAssuntoId ? await noticiaDoAssuntoDaMarca(cliente.id, noticiaAssuntoId) : null;
  const origem = noticia
    ? { titulo: noticia.titulo, resumo: noticia.resumo, angulo: noticia.angulo }
    : noticiaDoAssunto
      ? noticiaDoAssuntoComoPontoDePartida(noticiaDoAssunto)
      : undefined;
  return avaliarTema(cliente, texto, origem, assuntoEmAlta);
}
