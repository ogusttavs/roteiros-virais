"use server";

import type { EstiloRoteiro, Objetivo } from "@/db/schema";
import { sugerirEstiloPelaEvidencia } from "@/ia/enums";
import { ErroIA } from "@/ia/erro";
import { type ResultadoAcao } from "@/lib/resultado-acao";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { evidenciaParaRoteiro } from "@/servicos/pesquisa";
import { ramosAlternativosDaMarca } from "@/servicos/ramos-da-conta";
import {
  ErroRoteiro,
  gerarRoteiro,
  validarData,
  validarEstilo,
  validarFormato,
  validarMomentoDoDia,
  validarQuemAparece,
  type OrigemRoteiro,
} from "@/servicos/roteiro";

/**
 * `/hoje/objetivo` (etapa 11; V9c, item 1: `formato` do controle segmentado; M4, item 2: `estilo`,
 * o segundo controle). O cliente sempre vem da sessão. `formato`, `estilo` e `quemAparece` chegam
 * como texto livre do navegador (V9d, item 2): `validarFormato`/`validarEstilo`/`validarQuemAparece`
 * conferem contra a lista antes de chegar ao banco.
 *
 * R1, item 0c: `ErroIA.mensagemCliente` e `ErroRoteiro.message` vêm como resultado, não lançados
 * (Next.js troca a mensagem de uma exceção por um texto genérico em produção); erro de outra
 * natureza (rede, bug) continua subindo, para a tela de espera cair no caminho de sempre.
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
  /** E39a: "para quando é?", ISO; sem valor, hoje. */
  data?: string,
  /** E39a: "em que momento do dia?", só quando o formato é Story. */
  momentoDoDia?: string,
  /** E43: presente quando o tema veio de "Criar vídeo com esta notícia" (Tema livre, `?noticiaId=`). */
  noticiaId?: number,
): Promise<ResultadoAcao<{ id: number }>> {
  const cliente = await clienteDaSessaoAtual();
  try {
    const roteiro = await gerarRoteiro(cliente.id, {
      ...origem,
      objetivo,
      formato: validarFormato(formato),
      estilo: validarEstilo(estilo),
      objetivoDoVideo: objetivoDoVideo?.trim() || undefined,
      quemAparece: validarQuemAparece(quemAparece),
      data: validarData(data),
      momentoDoDia: validarMomentoDoDia(momentoDoDia),
      noticiaId,
    });
    return { ok: true, dado: { id: roteiro.id } };
  } catch (falha) {
    if (falha instanceof ErroIA) return { ok: false, erro: falha.mensagemCliente };
    if (falha instanceof ErroRoteiro) return { ok: false, erro: falha.message };
    throw falha;
  }
}

/**
 * M4, item 2: a sugestão de estilo pela evidência do tema (mais da metade sem fala sugere sem
 * fala; empate ou sem evidência vale falado). Chamada quando a tela de objetivo monta, para o
 * controle já vir marcado; a pessoa troca se quiser.
 */
export async function sugerirEstiloAction(tema: string): Promise<EstiloRoteiro> {
  const cliente = await clienteDaSessaoAtual();
  if (!cliente.nichoId) return "falado";
  const alternativos = (await ramosAlternativosDaMarca(cliente.id)).map((a) => a.nichoId);
  const evidencias = await evidenciaParaRoteiro(cliente.nichoId, tema, undefined, alternativos);
  return sugerirEstiloPelaEvidencia(evidencias);
}
