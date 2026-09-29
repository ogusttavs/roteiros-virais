"use server";

import { revalidatePath } from "next/cache";

import type { Cliente } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { criarMarca, garantirSessaoAdmin } from "@/servicos/clientes";

/**
 * Defesa em duas camadas (revisao da etapa 3, PROXIMO.md): a Server Action
 * confere o papel explicitamente, sem confiar so no auth.api.createUser
 * recusar quem nao e admin. V12b, item 2: cria so a marca, sem ninguem; a
 * pessoa entra depois, dentro dela, por `darAcessoAction`.
 */
export async function criarMarcaAction(dados: {
  nome: string;
  nichoId: number;
  tipo: "negocio" | "pessoa";
  plano: "padrao" | "sem_limite";
}): Promise<Cliente> {
  garantirSessaoAdmin(await sessaoAtual());

  const marca = await criarMarca(dados);
  revalidatePath("/admin/clientes");
  return marca;
}
