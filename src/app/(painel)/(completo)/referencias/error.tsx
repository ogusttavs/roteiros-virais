"use client";

import { captureException } from "@sentry/nextjs";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { textosReferencias } from "@/textos/referencias";
import { Botao } from "@/ui/componentes/Botao";

import styles from "./ReferenciasTela.module.css";

/** Estado de erro de `/referencias` (design v2, `Referencias.dc.html`, estado "erro"). */
export default function ErroReferencias({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [tentando, iniciarTentativa] = useTransition();

  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <div className={styles.pagina}>
      <div className={styles.blocoVazio}>
        <span className={styles.avisoErro}>
          <AlertTriangle size={18} strokeWidth={1.75} aria-hidden="true" />
          {textosReferencias.erroAviso}
        </span>
        <h3>{textosReferencias.erroTitulo}</h3>
        <p>{textosReferencias.erroTexto}</p>
        {/*
          `reset()` sozinho renderiza de novo com a mesma resposta do servidor (V7, item 4 do PROXIMO.md): o
          `router.refresh()` é o que refaz o pedido. Em transição, para o botão mostrar o andamento e não aceitar
          toque duplo enquanto isso.
        */}
        <Botao
          variante="primario"
          tamanho="lg"
          carregando={tentando}
          onClick={() =>
            iniciarTentativa(() => {
              router.refresh();
              reset();
            })
          }
        >
          {textosReferencias.tentarDeNovo}
        </Botao>
      </div>
    </div>
  );
}
