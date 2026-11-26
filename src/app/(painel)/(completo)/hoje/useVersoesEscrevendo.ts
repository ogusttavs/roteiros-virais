"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { EstadoDosPedidos } from "@/servicos/pedidos-estado";
import { useConsultaViva } from "@/ui/useConsultaViva";

import { haEsperaGuardada, haEsperaSemResposta, limparEsperaDoPedido, pedidosDasEsperas } from "../criar/objetivo/espera-guardada";

export type VersoesProntasAoVivo = { grupo: string; tema: string; quantidade: number; paraQue: string };

/**
 * E74 PR 1: quem sai da espera para o Hoje vê que as versões estão sendo escritas e, quando ficam prontas, o cartão muda sozinho. A conferência é um GET numa rota comum, NÃO `router.refresh()`
 * (com a escrita ainda pendente no roteador, ele não pode entrar na fila de ações).
 *
 * E74 PR 2a (achado do Fable de 26/11, R-b): o cartão segue O PEDIDO, pelo id (o que o servidor diz que anda e os que esta aba pediu e guardou), nunca "o grupo mais novo da marca". Um grupo
 * antigo que falta escolher não apaga a espera do pedido novo: os dois aparecem, e quando o novo fica pronto, o cartão das prontas passa a ser o dele. A pergunta só sai com a aba visível, e a
 * volta à aba pergunta na hora (`useConsultaViva`, R-i e R-j).
 */
export function useVersoesEscrevendo(escrevendoNoServidor: boolean, pedidoIdDoServidor: string | null = null): { escrevendo: boolean; prontasAoVivo: VersoesProntasAoVivo | null } {
  const [servidorEscrevendo, setServidorEscrevendo] = useState(escrevendoNoServidor);
  const [naAba, setNaAba] = useState(false);
  const [prontasAoVivo, setProntasAoVivo] = useState<VersoesProntasAoVivo | null>(null);
  /** Os pedidos que este cartão segue: o que o servidor mostrou e os que esta aba pediu. */
  const seguidos = useRef(new Set<string>());

  useEffect(() => {
    setServidorEscrevendo(escrevendoNoServidor);
    if (pedidoIdDoServidor) seguidos.current.add(pedidoIdDoServidor);
    setNaAba(haEsperaGuardada());
  }, [escrevendoNoServidor, pedidoIdDoServidor]);

  const escrevendo = prontasAoVivo === null && (servidorEscrevendo || naAba);

  const consultar = useCallback(async () => {
    const resposta = await fetch("/api/pedidos/estado", { cache: "no-store" });
    if (!resposta.ok) return;
    const estado = (await resposta.json()) as EstadoDosPedidos;
    for (const id of pedidosDasEsperas()) seguidos.current.add(id);

    const andando = estado.emAndamento.find((p) => p.tipo === "roteiro");
    if (andando) seguidos.current.add(andando.id);

    // O pedido que este cartão segue e que ficou pronto: o cartão das prontas passa a ser o dele (se a pessoa ainda não escolheu em outra aba).
    const pronto = estado.prontosParaVer.find((p) => p.tipo === "roteiro" && seguidos.current.has(p.id) && p.resultadoTipo === "versoes" && p.resultadoId);
    for (const p of [...estado.prontosParaVer, ...estado.falhas]) {
      if (!seguidos.current.has(p.id)) continue;
      limparEsperaDoPedido(p.id);
      seguidos.current.delete(p.id);
    }
    if (pronto) {
      const grupo = estado.faltamEscolher.find((g) => g.grupo === pronto.resultadoId);
      if (grupo) setProntasAoVivo({ grupo: grupo.grupo, tema: grupo.tema, quantidade: grupo.quantidade, paraQue: grupo.paraQue });
    }
    setServidorEscrevendo(Boolean(andando));
    setNaAba(haEsperaSemResposta(new Set(estado.emAndamento.map((p) => p.id))));
  }, []);

  useConsultaViva(escrevendo, consultar);

  return { escrevendo, prontasAoVivo };
}
