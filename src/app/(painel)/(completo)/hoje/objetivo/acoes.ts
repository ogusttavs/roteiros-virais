"use server";

import type { FormatoRoteiro, Objetivo } from "@/db/schema";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { gerarRoteiro, type OrigemRoteiro } from "@/servicos/roteiro";

/** `/hoje/objetivo` (etapa 11; V9c, item 1: `formato` do controle segmentado). O cliente sempre vem da sessão. */
export async function gerarRoteiroAction(
  origem: OrigemRoteiro,
  objetivo: Objetivo,
  formato?: FormatoRoteiro,
): Promise<{ id: number }> {
  const cliente = await clienteDaSessaoAtual();
  const roteiro = await gerarRoteiro(cliente.id, { ...origem, objetivo, formato });
  return { id: roteiro.id };
}
