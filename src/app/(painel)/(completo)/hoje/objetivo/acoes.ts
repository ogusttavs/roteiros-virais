"use server";

import type { Objetivo } from "@/db/schema";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { gerarRoteiro, validarFormato, type OrigemRoteiro } from "@/servicos/roteiro";

/**
 * `/hoje/objetivo` (etapa 11; V9c, item 1: `formato` do controle segmentado). O cliente sempre vem
 * da sessão. `formato` chega como texto livre do navegador (V9d, item 2): `validarFormato` confere
 * contra `FORMATOS_ROTEIRO` antes de chegar ao banco.
 */
export async function gerarRoteiroAction(
  origem: OrigemRoteiro,
  objetivo: Objetivo,
  formato?: string,
): Promise<{ id: number }> {
  const cliente = await clienteDaSessaoAtual();
  const roteiro = await gerarRoteiro(cliente.id, { ...origem, objetivo, formato: validarFormato(formato) });
  return { id: roteiro.id };
}
