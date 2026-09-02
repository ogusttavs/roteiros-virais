"use server";

import { revalidatePath } from "next/cache";

import { sessaoAtual } from "@/lib/sessao";
import { criarClienteEConvidar, garantirSessaoAdmin } from "@/servicos/clientes";

/**
 * Defesa em duas camadas (revisao da etapa 3, PROXIMO.md): a Server Action
 * confere o papel explicitamente, sem confiar so no auth.api.createUser
 * recusar quem nao e admin.
 */
export async function criarClienteAction(dados: {
  nome: string;
  email: string;
  nichoId: number;
}): Promise<void> {
  garantirSessaoAdmin(await sessaoAtual());

  await criarClienteEConvidar(dados);
  revalidatePath("/admin/clientes");
}
