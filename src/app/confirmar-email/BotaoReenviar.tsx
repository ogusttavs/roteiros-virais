"use client";

import { useState, useTransition } from "react";

import { reenviarConfirmacaoAction } from "./acoes";
import styles from "./page.module.css";

/** O texto do botão vem de `textos/cadastro.ts` pela página (aqui só o que o navegador precisa). */
export function BotaoReenviar({ rotulo }: { rotulo: string }) {
  const [frase, setFrase] = useState<string | null>(null);
  const [pendente, comecar] = useTransition();
  return (
    <>
      <button
        type="button"
        className={styles.botao}
        disabled={pendente}
        onClick={() =>
          comecar(async () => {
            const r = await reenviarConfirmacaoAction();
            setFrase(r.frase);
          })
        }
      >
        {rotulo}
      </button>
      {frase ? (
        <p className={styles.aviso} role="status">
          {frase}
        </p>
      ) : null}
    </>
  );
}
