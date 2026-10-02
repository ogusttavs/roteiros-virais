"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { textosHoje } from "@/textos/hoje";
import { Toast } from "@/ui/componentes/Toast";

import { arquivarAtrasadoAction, desarquivarAction } from "./agenda-acoes";

/**
 * "Arquivar" com desfazer (E39c, parte 2a: "com desfazer por alguns segundos no arquivar").
 * Fica no dono da lista (`HojeTela.tsx`, `DiaConteudo.tsx`, `SemanaTela.tsx`), não em
 * `MenuAcoesAgenda.tsx`: o item some da lista assim que `router.refresh()` termina, e o menu dele
 * (com o Toast dentro) desmontaria junto, cortando o "Desfazer" antes da pessoa conseguir tocar.
 */
export function useDesfazerArquivar() {
  const router = useRouter();
  const [toastAberto, setToastAberto] = useState(false);
  const [roteiroId, setRoteiroId] = useState<number | null>(null);

  async function arquivar(id: number) {
    await arquivarAtrasadoAction(id);
    setRoteiroId(id);
    setToastAberto(true);
    router.refresh();
  }

  function desfazer() {
    if (roteiroId === null) return;
    desarquivarAction(roteiroId)
      .then(() => router.refresh())
      .catch(() => {
        // Fica arquivado; a pessoa acha o roteiro no Histórico e desarquiva de lá.
      });
  }

  const toast = (
    <Toast
      texto={textosHoje.agenda.menu.arquivadoToast}
      aberto={toastAberto}
      onFechar={() => setToastAberto(false)}
      acao={{ rotulo: textosHoje.agenda.menu.desfazer, onClique: desfazer }}
    />
  );

  return { arquivar, toast };
}
