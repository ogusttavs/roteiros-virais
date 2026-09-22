"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { limparCachesDoAparelho } from "@/lib/offline";
import { textosConexao } from "@/textos/conexao";
import { textosConta } from "@/textos/conta";
import { useTratarFalha } from "@/ui/ConexaoContext";

import styles from "./page.module.css";

/**
 * `className`, `rotulo` e `rotuloSaindo` (rodada de acabamento de 06/09,
 * item 6): a casca do admin reusa este mesmo botao, com a classe e o texto
 * do proprio cabecalho dela, em vez de duplicar a logica de `signOut`.
 */
export function BotaoSair({
  className = styles.linkSair,
  rotulo = textosConta.sair,
  rotuloSaindo = textosConta.saindo,
}: {
  className?: string;
  rotulo?: string;
  rotuloSaindo?: string;
}) {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const tratarFalha = useTratarFalha();

  async function sair() {
    if (saindo) return;
    setSaindo(true);
    setErro(null);
    // O que o aparelho guardou para abrir sem rede é dado de cliente: apaga ANTES de encerrar a sessão
    // (V7, item 7 do PROXIMO.md), para não sobrar nada se a saída falhar no meio.
    await limparCachesDoAparelho();
    try {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "signOut falhou");
    } catch (falha) {
      // A sessão continua de pé no servidor: não vai para /entrar como se tivesse saído, e o botão volta.
      setErro(tratarFalha(falha, textosConta.erroSair, textosConexao.semConexaoParaSair));
      setSaindo(false);
      return;
    }
    router.push("/entrar");
    router.refresh();
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void sair()} disabled={saindo}>
        {saindo ? rotuloSaindo : rotulo}
      </button>
      {erro ? (
        <p role="alert" className={styles.erro}>
          {erro}
        </p>
      ) : null}
    </>
  );
}
