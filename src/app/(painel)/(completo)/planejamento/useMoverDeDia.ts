"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type DragEvent } from "react";

import type { FormatoRoteiro } from "@/db/schema";
import { dadoOuErro, ErroDeAcao } from "@/lib/resultado-acao";
import { textosHoje } from "@/textos/hoje";

import { mudarDataAtrasadoAction } from "../hoje/agenda-acoes";

/** Do tablet deitado para cima (passo 12 do Opus); abaixo disso o arrasto não começa e o menu
 * de três ações continua sendo o único caminho, como em qualquer tamanho de tela. */
const LARGURA_ARRASTO = 1024;

type ItemArrastavel = { id: number; tipo: FormatoRoteiro; titulo: string };

/**
 * E39c, parte 2b: mover um item de dia arrastando, na Semana e no Mês, do tablet deitado para
 * cima. O caminho pelo teclado é o que já existe (o menu de três ações, "Não vou gravar hoje",
 * que abre a mesma folha "Mudar o dia"); o arrasto é só outro jeito de chegar na mesma ação
 * (`mudarDataAtrasadoAction`), nunca uma segunda regra. Por isso só os itens que já têm o menu
 * (um roteiro escrito, não "a gravar" num dia passado) ficam arrastáveis; um sugerido continua
 * sem jeito de mudar de dia nesta rodada (hipótese já registrada na parte 2a).
 *
 * Soltar num dia que já tem um item do mesmo formato (Reels com Reels, Story com Story) pede
 * confirmação antes de gravar, para nunca duplicar sem a pessoa perceber; soltar num dia livre
 * move na hora. Dono do estado: cada visão (`SemanaConteudo`, `MesConteudo`) decide, olhando os
 * próprios dias, se o alvo tem conflito (`temConflito`) e se está bloqueado (`bloqueado`, dia
 * passado ou o próprio dia de origem).
 */
export function useMoverDeDia() {
  const router = useRouter();
  const [itemArrastando, setItemArrastando] = useState<(ItemArrastavel & { deData: string }) | null>(null);
  const [diaAlvo, setDiaAlvo] = useState<string | null>(null);
  const [pendente, setPendente] = useState<(ItemArrastavel & { paraData: string }) | null>(null);
  const [movendo, iniciarTransicao] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function aoComecarArrasto(evento: DragEvent, item: ItemArrastavel, deData: string) {
    if (window.innerWidth < LARGURA_ARRASTO) {
      evento.preventDefault();
      return;
    }
    evento.dataTransfer.effectAllowed = "move";
    evento.dataTransfer.setData("text/plain", String(item.id));
    setErro(null);
    setItemArrastando({ ...item, deData });
  }

  function aoTerminarArrasto() {
    setItemArrastando(null);
    setDiaAlvo(null);
  }

  function aoPassarPorCimaDoDia(evento: DragEvent, data: string, bloqueado: boolean) {
    if (!itemArrastando || bloqueado || data === itemArrastando.deData) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    if (diaAlvo !== data) setDiaAlvo(data);
  }

  function aoSairDoDia(evento: DragEvent, data: string) {
    if (diaAlvo !== data) return;
    const indoPara = evento.relatedTarget as Node | null;
    if (indoPara && evento.currentTarget.contains(indoPara)) return;
    setDiaAlvo(null);
  }

  function mover(item: ItemArrastavel, paraData: string) {
    setErro(null);
    iniciarTransicao(async () => {
      try {
        dadoOuErro(await mudarDataAtrasadoAction(item.id, paraData));
        router.refresh();
      } catch (falha) {
        // A frase de recusa do servidor ("Não muda de dia: ...") chega inteira; qualquer outra falha cai no texto de sempre.
        setErro(falha instanceof ErroDeAcao ? falha.message : textosHoje.agenda.planejador.erroMover);
      }
    });
  }

  function aoSoltarNoDia(evento: DragEvent, data: string, temConflito: boolean) {
    evento.preventDefault();
    const item = itemArrastando;
    aoTerminarArrasto();
    if (!item || data === item.deData) return;
    if (temConflito) {
      setPendente({ id: item.id, tipo: item.tipo, titulo: item.titulo, paraData: data });
      return;
    }
    mover(item, data);
  }

  function confirmarMoverMesmoAssim() {
    if (!pendente) return;
    mover(pendente, pendente.paraData);
    setPendente(null);
  }

  function cancelarMover() {
    setPendente(null);
  }

  return {
    itemArrastando,
    diaAlvo,
    pendente,
    movendo,
    erro,
    aoComecarArrasto,
    aoTerminarArrasto,
    aoPassarPorCimaDoDia,
    aoSairDoDia,
    aoSoltarNoDia,
    confirmarMoverMesmoAssim,
    cancelarMover,
  };
}
