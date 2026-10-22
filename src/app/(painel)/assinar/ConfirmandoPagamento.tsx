"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { textosAssinatura } from "@/textos/assinatura";

const INTERVALO_MS = 3000;
const TENTATIVAS = 20;

/**
 * E22 PR 1 (provisorio): a pessoa voltou do pagamento e o aviso do Stripe ainda nao chegou. Em vez do botao "Assinar" (que deixaria pagar duas vezes), a pagina diz que esta
 * confirmando e se atualiza a cada 3 segundos, por um minuto; chegou o aviso, o servidor a leva para o Hoje.
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

  return <p role="status">{tentativas >= TENTATIVAS ? textosAssinatura.confirmandoDemora : textosAssinatura.confirmando}</p>;
}
