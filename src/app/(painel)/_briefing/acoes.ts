"use server";

import { organizarFalaBriefing } from "@/servicos/briefing";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import {
  adicionarPerfilCitado,
  perfisCitadosDoCliente,
  removerPerfilCitado,
  type PerfilCitado,
  type TipoPerfilCitado,
} from "@/servicos/perfis-citados";

/**
 * P2, item 3: o caminho por áudio de `PerguntaCampo` passa por aqui depois de `/api/transcrever`
 * devolver o texto. M4, item 0d da revisão do PR #77: a marca da sessão vai para
 * `registrarGeracao`, para o custo aparecer nela (antes, a geração ficava sem dono).
 */
export async function organizarFalaBriefingAction(pergunta: string, textoFalado: string): Promise<string> {
  const cliente = await clienteDaSessaoAtual();
  return organizarFalaBriefing(pergunta, textoFalado, cliente.id);
}

/**
 * V12c, item 7, a E37b: os dois editores de @ acima do campo de texto da P12. A marca sempre vem
 * da sessão, mesmo padrão do resto do painel; `EditorPerfisCitados` busca a lista ao montar.
 */
export async function listarPerfisCitadosAction(): Promise<{ concorrentes: PerfilCitado[]; admira: PerfilCitado[] }> {
  const cliente = await clienteDaSessaoAtual();
  return perfisCitadosDoCliente(cliente.id);
}

export async function adicionarPerfilCitadoAction(tipo: TipoPerfilCitado, dados: unknown): Promise<PerfilCitado> {
  const cliente = await clienteDaSessaoAtual();
  return adicionarPerfilCitado(cliente.id, tipo, dados);
}

export async function removerPerfilCitadoAction(id: number): Promise<void> {
  const cliente = await clienteDaSessaoAtual();
  await removerPerfilCitado(id, cliente.id);
}
