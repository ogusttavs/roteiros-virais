"use server";

import { revalidatePath } from "next/cache";

import { exigirForaDoVerComo } from "@/lib/ver-como";
import { adicionarAssunto, ErroAssunto, fixarAssunto, registrarAberturaDeNoticia, removerAssunto } from "@/servicos/assuntos";
import { clienteDaSessaoAtual } from "@/servicos/clientes";

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
  return comoAssunto(async (clienteId) => {
    await adicionarAssunto(clienteId, texto, palavras);
  });
}

export async function tirarAssuntoAction(assuntoId: number): Promise<ResultadoAssunto> {
  await exigirForaDoVerComo();
  return comoAssunto((clienteId) => removerAssunto(clienteId, assuntoId));
}

/** "Manter" fixa o assunto: ele deixa de sair sozinho depois de 30 dias sem notícia aberta. */
export async function manterAssuntoAction(assuntoId: number): Promise<ResultadoAssunto> {
  await exigirForaDoVerComo();
  return comoAssunto((clienteId) => fixarAssunto(clienteId, assuntoId, true));
}

/**
 * A pessoa abriu uma notícia de um assunto dela (o título, ou "Criar roteiro"): é o que mantém o assunto vivo. Só de notícia de assunto da própria marca. No "ver como" a função recusa antes
 * de gravar (quem olha como a pessoa não mantém o assunto dela vivo); o chamador no navegador ignora a recusa e abre o original do mesmo jeito.
 */
export async function abrirNoticiaDoAssuntoAction(noticiaId: number): Promise<void> {
  await exigirForaDoVerComo();
  const cliente = await clienteDaSessaoAtual();
  try {
    await registrarAberturaDeNoticia(cliente.id, noticiaId);
  } catch (erro) {
    if (erro instanceof ErroAssunto) return;
    throw erro;
  }
}
