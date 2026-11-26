"use server";

import { revalidatePath } from "next/cache";

import { MAXIMO_RESPONSAVEL_TECNICO, validarResponsavelTecnico } from "@/carrossel/responsavel-tecnico";
import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import type { ResultadoAcao } from "@/lib/resultado-acao";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { marcaEhDeSaude } from "@/servicos/carrossel";
import { clienteAtivoDoUsuario, definirResponsavelTecnico } from "@/servicos/clientes";
import { textosConta } from "@/textos/conta";

const t = textosConta.responsavel;

/**
 * Grava a linha do responsável técnico (a que sai no último slide do carrossel de saúde). Marca e pessoa vêm da sessão, nunca de um parâmetro; no "ver como" nunca grava; só
 * marca de ramo de saúde grava; vazio apaga. Devolve a linha já limpa para a tela mostrar o que ficou guardado.
 */
export async function salvarResponsavelTecnicoAction(linha: string): Promise<ResultadoAcao<{ linha: string | null }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  await exigirAssinaturaValida();
  const sessao = await sessaoDoPainel();
  if (!sessao) return { ok: false, erro: t.semAcesso };
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente || !(await marcaEhDeSaude(cliente.id))) return { ok: false, erro: t.semAcesso };
  const validada = validarResponsavelTecnico(linha);
  if (!validada.ok) return { ok: false, erro: validada.motivo === "longo" ? t.longo(MAXIMO_RESPONSAVEL_TECNICO) : t[validada.motivo] };
  await definirResponsavelTecnico(cliente.id, validada.linha);
  revalidatePath("/conta");
  return { ok: true, dado: { linha: validada.linha } };
}
