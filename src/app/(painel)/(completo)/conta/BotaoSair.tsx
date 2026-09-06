"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { textosConta } from "@/textos/conta";

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

  async function sair() {
    setSaindo(true);
    await authClient.signOut();
    router.push("/entrar");
    router.refresh();
  }

  return (
    <button type="button" className={className} onClick={() => void sair()} disabled={saindo}>
      {saindo ? rotuloSaindo : rotulo}
    </button>
  );
}
