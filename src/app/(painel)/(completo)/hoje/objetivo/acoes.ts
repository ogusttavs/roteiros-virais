"use server";

import type { Objetivo } from "@/db/schema";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { gerarRoteiro, type OrigemRoteiro } from "@/servicos/roteiro";

/** `/hoje/objetivo` (etapa 11). O cliente sempre vem da sessão, nunca de um parâmetro. */
export async function gerarRoteiroAction(origem: OrigemRoteiro, objetivo: Objetivo): Promise<{ id: number }> {
  const cliente = await clienteDaSessaoAtual();
  const roteiro = await gerarRoteiro(cliente.id, { ...origem, objetivo });
  return { id: roteiro.id };
}
