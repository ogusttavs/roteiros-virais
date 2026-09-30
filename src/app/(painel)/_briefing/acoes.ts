"use server";

import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado } from "@/servicos/clientes";
import { organizarFalaBriefing } from "@/servicos/briefing";

/**
 * P2, item 3: o caminho por áudio de `PerguntaCampo` passa por aqui depois de `/api/transcrever`
 * devolver o texto. Sessão só para não gastar a tarefa barata sem ninguém logado; o resultado não
 * depende de marca nenhuma (mesmo espírito de `lerMomentoDeTextoAction`).
 */
export async function organizarFalaBriefingAction(pergunta: string, textoFalado: string): Promise<string> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  return organizarFalaBriefing(pergunta, textoFalado);
}
