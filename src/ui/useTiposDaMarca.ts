"use client";

import { useRef, useState } from "react";

import { responderFormatosAction } from "@/app/(painel)/_casca/formatos-acoes";
import { FORMATOS_DO_CATALOGO } from "@/config/formatos";
import { textosTipos } from "@/textos/tipos";

export type TipoLigado = { chave: string; ligada: boolean };

/**
 * O estado dos tipos de vídeo de uma marca na tela do cliente (E44 PR 2): as treze chaves, cada uma ligada ou desligada, começando do que o servidor mandou. Cada troca
 * grava na hora (`responderFormatosAction`, uma chave por vez, `quem = cliente`) e vale a partir do próximo roteiro; a chave troca de lado já (otimista) e volta, com a frase
 * de erro, se o servidor não guardou. Sem botão de salvar.
 */
export function useTiposDaMarca(iniciais: readonly TipoLigado[]) {
  const [estado, setEstado] = useState<Record<string, boolean>>(() => Object.fromEntries(FORMATOS_DO_CATALOGO.map((f) => [f.chave, iniciais.find((i) => i.chave === f.chave)?.ligada ?? f.ligadaPorPadrao])));
  const [erro, setErro] = useState<string | null>(null);
  // Duas trocas em seguida na mesma chave não se atropelam: a última a voltar do servidor é a que vale.
  const ultimaDaChave = useRef<Record<string, number>>({});

  async function trocar(chave: string, ligada: boolean) {
    setErro(null);
    setEstado((atual) => ({ ...atual, [chave]: ligada }));
    const numero = (ultimaDaChave.current[chave] ?? 0) + 1;
    ultimaDaChave.current[chave] = numero;
    let gravou = false;
    try {
      gravou = await responderFormatosAction({ [chave]: ligada });
    } catch {
      gravou = false;
    }
    if (!gravou && ultimaDaChave.current[chave] === numero) {
      setEstado((atual) => ({ ...atual, [chave]: !ligada }));
      setErro(textosTipos.erro);
    }
  }

  const ligados = FORMATOS_DO_CATALOGO.filter((f) => estado[f.chave]).length;
  const trocados = FORMATOS_DO_CATALOGO.filter((f) => estado[f.chave] !== f.ligadaPorPadrao).length;

  return { estado, trocar, erro, ligados, trocados, total: FORMATOS_DO_CATALOGO.length };
}
