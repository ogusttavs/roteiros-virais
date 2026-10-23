"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { textosAssinatura } from "@/textos/assinatura";

import styles from "./page.module.css";

const INTERVALO_MS = 3000;
const TENTATIVAS = 20;

/**
 * A pessoa voltou do pagamento e o aviso do Stripe ainda não chegou. Em vez do botão "Assinar" (que deixaria pagar duas vezes), a página diz que está confirmando e se atualiza a
 * cada 3 segundos, por um minuto; chegou o aviso, o servidor mostra a assinatura confirmada. Passado o minuto, a frase muda para "não pague de novo".
 */
export function ConfirmandoPagamento() {
  const router = useRouter();
  const [tentativas, setTentativas] = useState(0);

  useEffect(() => {
    if (tentativas >= TENTATIVAS) return;
    const id = setTimeout(() => {
      router.refresh();
      setTentativas((n) => n + 1);
    }, INTERVALO_MS);
    return () => clearTimeout(id);
  }, [tentativas, router]);

  const demorou = tentativas >= TENTATIVAS;
  return (
    <p role="status" className={styles.estadoDeEspera}>
      {demorou ? null : <span className={styles.girando} aria-hidden="true" />}
      <span>{demorou ? textosAssinatura.situacoes.aguardando.demora : textosAssinatura.situacoes.aguardando.frase}</span>
    </p>
  );
}
