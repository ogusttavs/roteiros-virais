"use client";

import { useEffect, useState, useTransition } from "react";

import { textosConexao } from "@/textos/conexao";
import { textosNav } from "@/textos/nav";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

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
  const { avisarRedeOk } = useConexao();
  const tratarFalha = useTratarFalha();

  useEffect(() => {
    if (!pendente) setMarcaAlvo(null);
  }, [pendente]);

  function trocar(clienteId: number, nomeMarca: string) {
    setErro(null);
    setMarcaAlvo(nomeMarca);
    iniciarTransicao(async () => {
      try {
        // O roteiro guardado da marca de antes não pode aparecer sem rede na marca nova (V7, item 7): quem
        // apaga é `Conexao` (`registrarEscopo`) quando o painel reabre com a marca nova, não daqui. Apagar
        // antes da ação tiraria a cópia da marca atual justo quando a troca falha por falta de rede, e
        // apagar depois disputaria com o escopo novo que `Conexao` acabou de gravar.
        await trocarMarcaAction(clienteId);
        avisarRedeOk();
      } catch (falha) {
        setErro(tratarFalha(falha, textosNav.erroTrocarMarca, textosConexao.trocarDeMarcaSemRede));
      }
    });
  }

  return { trocar, trocando: pendente, marcaAlvo, erro };
}
