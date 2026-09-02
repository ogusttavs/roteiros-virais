"use server";

import { revalidatePath } from "next/cache";

import { criarClienteEConvidar } from "@/servicos/clientes";

export async function criarClienteAction(dados: {
  nome: string;
  email: string;
  nichoId: number;
}): Promise<void> {
  await criarClienteEConvidar(dados);
  revalidatePath("/admin/clientes");
}
