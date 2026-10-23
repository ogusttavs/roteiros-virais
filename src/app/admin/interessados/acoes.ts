"use server";

import { revalidatePath } from "next/cache";

import { sessaoAtual } from "@/lib/sessao";
import { garantirSessaoAdmin } from "@/servicos/clientes";
import { apagarInteressado } from "@/servicos/interessados";

/** Apaga uma pessoa da lista de interessados (E57a): o pedido de apagar os dados que o `/privacidade` promete. Só o admin. */
export async function apagarInteressadoAction(id: number): Promise<{ ok: boolean }> {
  garantirSessaoAdmin(await sessaoAtual());
  if (!Number.isInteger(id) || id <= 0) return { ok: false };
  await apagarInteressado(id);
  revalidatePath("/admin/interessados");
  return { ok: true };
}
