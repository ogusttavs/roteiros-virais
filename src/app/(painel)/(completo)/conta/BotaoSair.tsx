"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { textosConta } from "@/textos/conta";

import styles from "./page.module.css";

export function BotaoSair() {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    setSaindo(true);
    await authClient.signOut();
    router.push("/entrar");
    router.refresh();
  }

  return (
    <button type="button" className={styles.linkSair} onClick={() => void sair()} disabled={saindo}>
      {saindo ? textosConta.saindo : textosConta.sair}
    </button>
  );
}
