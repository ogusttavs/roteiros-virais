"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  classificarMultiplo,
  diasDesde,
  formatarMultiplo,
  formatarViewsCompacto,
  fraseDiasAtras,
  rotuloMultiploConta,
} from "@/lib/formatarNumero";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { evidenciaResumoPorIds, type EvidenciaResumo } from "@/servicos/pesquisa";
import { arquivarRoteiro, conferirAindaVale, desarquivarRoteiro, mudarDataRoteiro, roteiroPorId } from "@/servicos/roteiro";
import type { EvidenciaTema } from "@/ui/componentes/TemaCartao";

/**
 * Confere que o roteiro pertence à marca ativa antes de qualquer ação (mesmo padrão de
 * `roteiros/[id]/acoes.ts`).
 */
async function roteiroDoClienteOuFalha(roteiroId: number) {
  const cliente = await clienteDaSessaoAtual();
  const roteiro = await roteiroPorId(roteiroId, cliente.id);
  if (!roteiro) redirect("/hoje");
  return roteiro;
}

/**
 * `router.refresh()` (quem chama estas ações) e `revalidatePath` juntos: o primeiro repete o
 * `fetch` do servidor na hora, sem esperar o `staleTime` do roteador; o segundo invalida o cache
 * do lado do servidor, para o `/hoje` e o `/planejamento` nunca devolverem uma página antiga
 * quando a pessoa navega para lá por outro caminho (um link, o histórico do navegador) logo em
 * seguida. `/hoje/mes` virou um redirect fino (E39c, parte 2a), não precisa mais de cache próprio.
 */
function revalidarAgenda() {
  revalidatePath("/hoje");
  revalidatePath("/planejamento");
}

/** E39b, item (b): "Arquivar" num atrasado; também o menu de três ações (E39c, parte 2a). */
export async function arquivarAtrasadoAction(roteiroId: number): Promise<void> {
  await roteiroDoClienteOuFalha(roteiroId);
  await arquivarRoteiro(roteiroId);
  revalidarAgenda();
}

/** E39c, parte 2a: o "desfazer" do toast de "Arquivar" no menu de três ações. */
export async function desarquivarAction(roteiroId: number): Promise<void> {
  await roteiroDoClienteOuFalha(roteiroId);
  await desarquivarRoteiro(roteiroId);
  revalidarAgenda();
}

/** E39b, item (b): "Mudar o dia" e "Gravar hoje" (o cliente manda a data de hoje nesse caso). */
export async function mudarDataAtrasadoAction(roteiroId: number, novaData: string): Promise<void> {
  await roteiroDoClienteOuFalha(roteiroId);
  await mudarDataRoteiro(roteiroId, novaData);
  revalidarAgenda();
}

function paraEvidenciaTema(resumo: EvidenciaResumo | null): EvidenciaTema | null {
  if (!resumo) return null;
  const faixa = classificarMultiplo(resumo.multiplicador);
  return {
    conta: resumo.contaNome ?? resumo.contaHandle,
    multiplo: formatarMultiplo(resumo.multiplicador),
    rotulo: rotuloMultiploConta(faixa, resumo.contaMedianaOrigem),
    views: formatarViewsCompacto(resumo.views),
    quando: resumo.publicadoEm ? fraseDiasAtras(diasDesde(resumo.publicadoEm)) : fraseDiasAtras(0),
    parecidos: resumo.quantidadeParecidos,
  };
}

export type RespostaAindaVale = { vale: true } | { vale: false; assunto: string; evidencia: EvidenciaTema | null };

/**
 * E39b, item (a): "Conferir" no Reels em destaque, feito com antecedência. Devolve a resposta já
 * pronta para a tela (com a evidência formatada, quando houver) em vez de só o `AindaValeResultado`
 * cru: `AindaValeBloco` mostra este retorno na hora, sem depender de `router.refresh()` buscar de
 * novo a tempo (achado desta etapa: sob carga, o refresh podia demorar mais que a espera do teste).
 */
export async function conferirAindaValeAction(roteiroId: number): Promise<RespostaAindaVale> {
  await roteiroDoClienteOuFalha(roteiroId);
  const resultado = await conferirAindaVale(roteiroId);
  revalidarAgenda();

  if (resultado.vale) return { vale: true };
  const evidencia = await evidenciaResumoPorIds([resultado.videoId]);
  return { vale: false, assunto: resultado.assunto, evidencia: paraEvidenciaTema(evidencia) };
}
