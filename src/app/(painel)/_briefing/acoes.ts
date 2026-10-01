"use server";

import { organizarFalaBriefing } from "@/servicos/briefing";
import { clienteDaSessaoAtual } from "@/servicos/clientes";

/**
 * P2, item 3: o caminho por áudio de `PerguntaCampo` passa por aqui depois de `/api/transcrever`
 * devolver o texto. M4, item 0d da revisão do PR #77: a marca da sessão vai para
 * `registrarGeracao`, para o custo aparecer nela (antes, a geração ficava sem dono).
 */
export async function organizarFalaBriefingAction(pergunta: string, textoFalado: string): Promise<string> {
  const cliente = await clienteDaSessaoAtual();
  return organizarFalaBriefing(pergunta, textoFalado, cliente.id);
}
