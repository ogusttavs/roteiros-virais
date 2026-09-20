"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { textosNav } from "@/textos/nav";

import { trocarMarcaAction } from "./marca-acoes";

/**
 * A troca de marca (V3, item 3): grava o cookie pela Server Action e
 * `router.refresh()` reexecuta o layout e a rota atual no servidor com a
 * marca nova (mesmo padrao de `FolhaAceiteTermos`). `marcaAlvo` guarda o
 * nome da marca escolhida enquanto a troca esta em andamento, para o
 * chamador mostrar "Abrindo <marca>" (o estado `trocando` do design).
 */
export function useTrocarMarca() {
  const router = useRouter();
  const [pendente, iniciarTransicao] = useTransition();
  const [marcaAlvo, setMarcaAlvo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function trocar(clienteId: number, nomeMarca: string) {
    setErro(null);
    setMarcaAlvo(nomeMarca);
    iniciarTransicao(async () => {
      try {
        await trocarMarcaAction(clienteId);
        router.refresh();
      } catch {
        setErro(textosNav.erroTrocarMarca);
      } finally {
        setMarcaAlvo(null);
      }
    });
  }

  return { trocar, trocando: pendente, marcaAlvo, erro };
}
