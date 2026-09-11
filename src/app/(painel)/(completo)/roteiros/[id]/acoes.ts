"use server";

import { redirect } from "next/navigation";

import type { IdMotivoReprovacao } from "@/config/motivos-reprovacao";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import {
  avaliarRoteiro,
  marcarGravado,
  marcarPostado,
  reprovarERescrever,
  roteiroPorId,
} from "@/servicos/roteiro";

/**
 * Confere que o roteiro pertence ao cliente da sessão antes de qualquer
 * ação (isolamento no nível de rota, mesmo padrão do briefing).
 */
async function roteiroDoClienteOuFalha(roteiroId: number) {
  const cliente = await clienteDaSessaoAtual();
  const roteiro = await roteiroPorId(roteiroId, cliente.id);
  if (!roteiro) redirect("/hoje");
  return roteiro;
}

export async function marcarGravadoAction(roteiroId: number): Promise<void> {
  await roteiroDoClienteOuFalha(roteiroId);
  await marcarGravado(roteiroId);
}

export async function marcarPostadoAction(roteiroId: number, url: string): Promise<void> {
  await roteiroDoClienteOuFalha(roteiroId);
  await marcarPostado(roteiroId, url);
}

export async function reprovarERescreverAction(
  roteiroId: number,
  motivosIds: IdMotivoReprovacao[],
  motivoTexto?: string,
): Promise<{ id: number }> {
  await roteiroDoClienteOuFalha(roteiroId);
  const novaVersao = await reprovarERescrever(roteiroId, motivosIds, motivoTexto);
  return { id: novaVersao.id };
}

export async function avaliarRoteiroAction(
  roteiroId: number,
  avaliacao: "gostei" | "nao_gostei",
): Promise<void> {
  await roteiroDoClienteOuFalha(roteiroId);
  await avaliarRoteiro(roteiroId, avaliacao);
}
