"use server";

import { redirect } from "next/navigation";

import type { IdMotivoReprovacao } from "@/config/motivos-reprovacao";
import type { MarcasDeFala } from "@/db/schema";
import { ErroIA } from "@/ia/erro";
import { type ResultadoAcao } from "@/lib/resultado-acao";
import { exigirForaDoVerComo, recusaDoVerComo } from "@/lib/ver-como";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { marcarFalaDoRoteiro, type MotivoSemMarcas } from "@/servicos/marcar-fala";
import { marcarGravado as marcarGravadoNoPlano } from "@/servicos/plano";
import {
  avaliarRoteiro,
  editarRoteiro,
  ErroRoteiro,
  marcarGravado,
  marcarPostado,
  reprovarERescrever,
  roteiroPorId,
  type CamposEditaveisRoteiro,
} from "@/servicos/roteiro";
import { textosMarcasDeFala } from "@/textos/marcas-de-fala";

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

/**
 * E41 (2a): escreve, na primeira vez, e devolve as marcas de fala do roteiro (`servicos/marcar-fala.ts`). Chamada quando a pessoa liga "Marcas de fala" ou abre o modo gravação, nunca na
 * geração. O roteiro é conferido por dono dentro do serviço (`roteiroPorId(id, clienteId)`); "ver como" não escreve (a leitura das marcas já guardadas é da tela). O erro esperado volta
 * como resultado, para a frase chegar inteira (Next.js troca a mensagem de uma exceção por um texto genérico em produção).
 */
export async function marcarFalaAction(roteiroId: number): Promise<ResultadoAcao<{ marcas: MarcasDeFala | null; motivo: MotivoSemMarcas | null; novas: boolean }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const cliente = await clienteDaSessaoAtual();
  // O id chega do navegador: algo que não é um inteiro positivo é "não achei", nunca um erro do banco.
  if (!Number.isInteger(roteiroId) || roteiroId <= 0) return { ok: false, erro: textosMarcasDeFala.erros.naoEncontrado };
  try {
    const r = await marcarFalaDoRoteiro(cliente.id, roteiroId);
    return r.ok ? { ok: true, dado: { marcas: r.marcas, motivo: null, novas: r.novas } } : { ok: true, dado: { marcas: null, motivo: r.motivo, novas: false } };
  } catch (falha) {
    if (falha instanceof ErroIA) return { ok: false, erro: falha.mensagemCliente };
    if (falha instanceof ErroRoteiro) return { ok: false, erro: falha.message };
    throw falha;
  }
}
