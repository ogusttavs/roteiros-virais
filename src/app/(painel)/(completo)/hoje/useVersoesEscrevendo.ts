"use client";

import { useEffect, useState } from "react";

import type { EstadoDasVersoes } from "@/app/api/versoes/estado/route";

import { haEsperaGuardada, limparEsperasGuardadas } from "../criar/objetivo/espera-guardada";

const INTERVALO_MS = 5000;

export type VersoesProntasAoVivo = Extract<EstadoDasVersoes, { estado: "prontas" }>;

/**
 * E74 PR 1: quem sai da espera para o Hoje vê que as versões estão sendo escritas (o servidor já tem uma ou duas, ou a escrita foi pedida nesta aba e ainda não gravou a primeira) e, quando
 * ficam prontas, o cartão muda sozinho. A conferência é um GET numa rota comum, de 5 em 5 segundos, e NÃO `router.refresh()`: com a escrita ainda pendente no roteador, um `router.refresh()`
 * fez o navegador pedir a escrita de novo (versões duplicadas, gasto da IA em dobro). Devolve `escrevendo` e, quando ficam prontas, os dados do cartão (`prontasAoVivo`).
 */
export function useVersoesEscrevendo(escrevendoNoServidor: boolean, prontas: boolean): { escrevendo: boolean; prontasAoVivo: VersoesProntasAoVivo | null } {
  const [naAba, setNaAba] = useState(false);
  const [prontasAoVivo, setProntasAoVivo] = useState<VersoesProntasAoVivo | null>(null);

  useEffect(() => {
    if (prontas) {
      limparEsperasGuardadas();
      setNaAba(false);
      setProntasAoVivo(null);
      return;
    }
    setNaAba(haEsperaGuardada());
  }, [prontas, escrevendoNoServidor]);

  const escrevendo = !prontas && prontasAoVivo === null && (escrevendoNoServidor || naAba);

  useEffect(() => {
    if (!escrevendo) return;
    let parou = false;
    const id = setInterval(async () => {
      try {
        const resposta = await fetch("/api/versoes/estado", { cache: "no-store" });
        if (!resposta.ok || parou) return;
        const estado = (await resposta.json()) as EstadoDasVersoes;
        if (parou) return;
        if (estado.estado === "prontas") {
          limparEsperasGuardadas();
          setProntasAoVivo(estado);
        } else {
          setNaAba(haEsperaGuardada());
        }
      } catch {
        // Sem rede agora: tenta de novo na próxima batida.
      }
    }, INTERVALO_MS);
    return () => {
      parou = true;
      clearInterval(id);
    };
  }, [escrevendo]);

  return { escrevendo, prontasAoVivo };
}
