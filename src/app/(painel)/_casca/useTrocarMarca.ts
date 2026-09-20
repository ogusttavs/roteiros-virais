"use client";

import { useEffect, useState, useTransition } from "react";

import { textosNav } from "@/textos/nav";

import { trocarMarcaAction } from "./marca-acoes";

/**
 * A troca de marca (V3, item 3): grava o cookie pela Server Action, que
 * revalida com `revalidatePath("/", "layout")` (`marca-acoes.ts`). Isso já
 * basta para o Next.js reexecutar o layout e a rota atual com a marca nova
 * como parte da resposta da propria Server Action; um `router.refresh()`
 * extra aqui competia com essa revalidacao (achado da revisao do PR #47: o
 * CI travava com a tela presa no esqueleto "Abrindo", porque as duas
 * atualizacoes disputavam a mesma transicao, e a pendencia do React nunca
 * resolvia). Um caminho so.
 *
 * `marcaAlvo` guarda o nome da marca escolhida enquanto a troca esta em
 * andamento, para o chamador mostrar "Abrindo <marca>" (o estado
 * `trocando` do design). So limpa quando a transicao realmente termina
 * (`pendente` volta a falso), nunca no `finally` do callback: o `finally`
 * roda antes de a revalidacao do Next.js de fato assentar, e limpar cedo
 * fazia a pilula voltar ao nome antigo e o Hoje mostrar "Abrindo " sem
 * nome por um instante (retoque da revisao do PR #47).
 */
export function useTrocarMarca() {
  const [pendente, iniciarTransicao] = useTransition();
  const [marcaAlvo, setMarcaAlvo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pendente) setMarcaAlvo(null);
  }, [pendente]);

  function trocar(clienteId: number, nomeMarca: string) {
    setErro(null);
    setMarcaAlvo(nomeMarca);
    iniciarTransicao(async () => {
      try {
        await trocarMarcaAction(clienteId);
      } catch {
        setErro(textosNav.erroTrocarMarca);
      }
    });
  }

  return { trocar, trocando: pendente, marcaAlvo, erro };
}
