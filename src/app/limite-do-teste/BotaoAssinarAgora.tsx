"use client";

import { useState } from "react";

import { assinarAgoraAction } from "@/app/(painel)/assinar/acoes";
import { textosAssinatura } from "@/textos/assinatura";

import styles from "./page.module.css";

/**
 * O botão de assinar da folha do limite do teste: chama a mesma `assinarAgoraAction` da tela de assinar (encerra o teste e cobra hoje; sem cartão, leva a cadastrá-lo). A ação devolve o
 * endereço para onde ir, ou a frase do que deu errado (cartão recusado, por exemplo), que aparece logo abaixo do botão.
 */
export function BotaoAssinarAgora({ rotulo }: { rotulo: string }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function assinar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await assinarAgoraAction();
      if (r.ok) {
        window.location.assign(r.dado.url);
        return;
      }
      setErro(r.erro);
    } catch {
      setErro(textosAssinatura.erroGenerico);
    }
    setOcupado(false);
  }

  return (
    <>
      <button type="button" className={styles.botao} onClick={assinar} disabled={ocupado} data-acao="assinarAgora">
        {rotulo}
      </button>
      {erro ? (
        <p role="alert" className={styles.erro}>
          {erro}
        </p>
      ) : null}
    </>
  );
}
