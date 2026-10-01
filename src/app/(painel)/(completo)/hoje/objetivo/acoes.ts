"use server";

import type { EstiloRoteiro, Objetivo } from "@/db/schema";
import { sugerirEstiloPelaEvidencia } from "@/ia/enums";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { evidenciaParaRoteiro } from "@/servicos/pesquisa";
import { gerarRoteiro, validarEstilo, validarFormato, validarQuemAparece, type OrigemRoteiro } from "@/servicos/roteiro";

/**
 * `/hoje/objetivo` (etapa 11; V9c, item 1: `formato` do controle segmentado; M4, item 2: `estilo`,
 * o segundo controle). O cliente sempre vem da sessão. `formato`, `estilo` e `quemAparece` chegam
 * como texto livre do navegador (V9d, item 2): `validarFormato`/`validarEstilo`/`validarQuemAparece`
 * conferem contra a lista antes de chegar ao banco.
 */
export async function gerarRoteiroAction(
  origem: OrigemRoteiro,
  objetivo: Objetivo,
  formato?: string,
  estilo?: string,
  /** E40, item 2: "o que este vídeo precisa comunicar?", campo opcional e curto. */
  objetivoDoVideo?: string,
  /** V12c, item 3, a E37b: troca só deste vídeo; sem valor, usa o quemGrava do cliente. */
  quemAparece?: string,
): Promise<{ id: number }> {
  const cliente = await clienteDaSessaoAtual();
  const roteiro = await gerarRoteiro(cliente.id, {
    ...origem,
    objetivo,
    formato: validarFormato(formato),
    estilo: validarEstilo(estilo),
    objetivoDoVideo: objetivoDoVideo?.trim() || undefined,
    quemAparece: validarQuemAparece(quemAparece),
  });
  return { id: roteiro.id };
}

/**
 * M4, item 2: a sugestão de estilo pela evidência do tema (mais da metade sem fala sugere sem
 * fala; empate ou sem evidência vale falado). Chamada quando a tela de objetivo monta, para o
 * controle já vir marcado; a pessoa troca se quiser.
 */
export async function sugerirEstiloAction(tema: string): Promise<EstiloRoteiro> {
  const cliente = await clienteDaSessaoAtual();
  if (!cliente.nichoId) return "falado";
  const evidencias = await evidenciaParaRoteiro(cliente.nichoId, tema);
  return sugerirEstiloPelaEvidencia(evidencias);
}
