"use server";

import { redirect } from "next/navigation";

import type { IdMotivoReprovacao } from "@/config/motivos-reprovacao";
import { exigirForaDoVerComo } from "@/lib/ver-como";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { marcarGravado as marcarGravadoNoPlano } from "@/servicos/plano";
import {
  avaliarRoteiro,
  editarRoteiro,
  marcarGravado,
  marcarPostado,
  reprovarERescrever,
  roteiroPorId,
  type CamposEditaveisRoteiro,
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
  await exigirForaDoVerComo();
  await roteiroDoClienteOuFalha(roteiroId);
  await marcarGravado(roteiroId);
  // V9b, item 3: fecha o círculo do plano quando este roteiro veio de um item aceito (sem-op sem plano).
  await marcarGravadoNoPlano(roteiroId);
}

export async function marcarPostadoAction(roteiroId: number, url: string): Promise<void> {
  await exigirForaDoVerComo();
  await roteiroDoClienteOuFalha(roteiroId);
  await marcarPostado(roteiroId, url);
}

export async function reprovarERescreverAction(
  roteiroId: number,
  motivosIds: IdMotivoReprovacao[],
  motivoTexto?: string,
): Promise<{ id: number }> {
  await exigirForaDoVerComo();
  await roteiroDoClienteOuFalha(roteiroId);
  const novaVersao = await reprovarERescrever(roteiroId, motivosIds, motivoTexto);
  return { id: novaVersao.id };
}

export async function avaliarRoteiroAction(
  roteiroId: number,
  avaliacao: "gostei" | "nao_gostei",
): Promise<void> {
  await exigirForaDoVerComo();
  await roteiroDoClienteOuFalha(roteiroId);
  await avaliarRoteiro(roteiroId, avaliacao);
}

/** E40, item 1: salva a edição manual da pessoa, sem chamar IA. */
export async function salvarEdicaoAction(
  roteiroId: number,
  campos: CamposEditaveisRoteiro,
): Promise<{ id: number }> {
  await exigirForaDoVerComo();
  await roteiroDoClienteOuFalha(roteiroId);
  const atualizado = await editarRoteiro(roteiroId, campos);
  return { id: atualizado.id };
}
