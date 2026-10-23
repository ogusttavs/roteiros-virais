"use server";

import { revalidatePath } from "next/cache";

import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import { exigirForaDoVerComo } from "@/lib/ver-como";
import { adicionarAssunto, ErroAssunto, fixarAssunto, registrarAberturaDeNoticia, removerAssunto } from "@/servicos/assuntos";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { ErroSugestaoDePalavras, sugerirPalavrasDoAssunto } from "@/servicos/palavras-do-assunto";
import { textosNoticias } from "@/textos/noticias";

export type ResultadoAssunto = { ok: true } | { ok: false; erro: string };

/** O cliente sempre vem da sessão, nunca de um parâmetro; cada ação chama `exigirForaDoVerComo` antes (o "ver como" recusa toda mudança: muda o que aparece e o que o roteiro usa, em nome da pessoa). */
async function comoAssunto(tarefa: (clienteId: number) => Promise<void>): Promise<ResultadoAssunto> {
  const cliente = await clienteDaSessaoAtual();
  try {
    await tarefa(cliente.id);
    revalidatePath("/noticias");
    return { ok: true };
  } catch (erro) {
    if (erro instanceof ErroAssunto) return { ok: false, erro: erro.message };
    throw erro;
  }
}

export async function acrescentarAssuntoAction(texto: string, palavras: string): Promise<ResultadoAssunto> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  return comoAssunto(async (clienteId) => {
    await adicionarAssunto(clienteId, texto, palavras);
  });
}

export async function tirarAssuntoAction(assuntoId: number): Promise<ResultadoAssunto> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  return comoAssunto((clienteId) => removerAssunto(clienteId, assuntoId));
}

/** "Manter" fixa o assunto: ele deixa de sair sozinho depois de 30 dias sem notícia aberta. */
export async function manterAssuntoAction(assuntoId: number): Promise<ResultadoAssunto> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  return comoAssunto((clienteId) => fixarAssunto(clienteId, assuntoId, true));
}

/**
 * A pessoa abriu uma notícia de um assunto dela (o título, ou "Criar roteiro"): é o que mantém o assunto vivo. Só de notícia de assunto da própria marca. No "ver como" a função recusa antes
 * de gravar (quem olha como a pessoa não mantém o assunto dela vivo); o chamador no navegador ignora a recusa e abre o original do mesmo jeito.
 */
export async function abrirNoticiaDoAssuntoAction(noticiaId: number): Promise<void> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  const cliente = await clienteDaSessaoAtual();
  try {
    await registrarAberturaDeNoticia(cliente.id, noticiaId);
  } catch (erro) {
    if (erro instanceof ErroAssunto) return;
    throw erro;
  }
}

export type ResultadoSugestao = { ok: true; palavras: string[] } | { ok: false; erro: string };

/**
 * "Sugerir palavras" na folha dos assuntos: o modelo barato propõe de 3 a 6 palavras de busca para um assunto que não está no catálogo (custo de centavos, com cache pelo texto e teto por marca por
 * dia). Gasta IA em nome da marca, então passa pelo "ver como" (recusa) e pelo portão da cobrança antes de qualquer outra coisa. Não muda nada do que é da pessoa: só devolve a sugestão.
 */
export async function sugerirPalavrasAction(texto: string): Promise<ResultadoSugestao> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  const cliente = await clienteDaSessaoAtual();
  try {
    const { palavras } = await sugerirPalavrasDoAssunto(cliente.id, texto);
    return { ok: true, palavras };
  } catch (erro) {
    if (erro instanceof ErroSugestaoDePalavras) {
      return { ok: false, erro: erro.motivo === "limite_do_dia" ? textosNoticias.erroSugerirLimite : erro.motivo === "assunto_curto" ? textosNoticias.erroSugerirCurto : textosNoticias.erroSugerir };
    }
    throw erro;
  }
}
