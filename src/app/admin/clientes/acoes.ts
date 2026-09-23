"use server";

import { revalidatePath } from "next/cache";

import { sessaoAtual } from "@/lib/sessao";
import { criarClienteEConvidar, garantirSessaoAdmin, type ResultadoCriarCliente } from "@/servicos/clientes";

/**
 * Defesa em duas camadas (revisao da etapa 3, PROXIMO.md): a Server Action
 * confere o papel explicitamente, sem confiar so no auth.api.createUser
 * recusar quem nao e admin. V3, item 5: devolve o resultado (e-mail que ja
 * tinha login entra direto; e-mail novo ganha senha gerada), para a modal
 * mostrar a tela certa.
 */
export async function criarClienteAction(dados: {
  nome: string;
  email: string;
  nichoId: number;
  tipo: "negocio" | "pessoa";
  plano: "padrao" | "sem_limite";
}): Promise<ResultadoCriarCliente> {
  garantirSessaoAdmin(await sessaoAtual());

  const resultado = await criarClienteEConvidar(dados);
  revalidatePath("/admin/clientes");
  return resultado;
}
