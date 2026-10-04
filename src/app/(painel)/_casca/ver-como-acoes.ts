"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { lerEstadoVerComo } from "@/lib/ver-como";
import { NOME_COOKIE_VER_COMO } from "@/lib/ver-como-cookie";
import { registrarSaidaVerComo } from "@/servicos/ver-como";

/**
 * "Sair do modo" (E46 PR 2, regra 3): fecha a entrada no banco, apaga o cookie na hora e volta à página da conta no admin. Fica na lista de leitura livre do `checar-ver-como`
 * (é a própria saída). Quem chama sem o modo ligado só tem o cookie apagado e vai para a raiz: não há nada a registrar.
 */
export async function sairDoVerComoAction(): Promise<void> {
  const estado = await lerEstadoVerComo();
  // O registro primeiro: se o banco falhar, a entrada não pode ficar aberta com o cookie já apagado (a ação falha, o cookie continua e a pessoa tenta de novo).
  if (estado.estado === "ativo") await registrarSaidaVerComo(estado.modo.entradaId, "saiu");
  (await cookies()).delete(NOME_COOKIE_VER_COMO);
  if (estado.estado === "ativo") redirect(`/admin/clientes/${estado.modo.clienteId}`);
  redirect("/");
}
