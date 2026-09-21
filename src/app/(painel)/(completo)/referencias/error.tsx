"use client";

import { captureException } from "@sentry/nextjs";
import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { textosReferencias } from "@/textos/referencias";
import { Botao } from "@/ui/componentes/Botao";

import styles from "./ReferenciasTela.module.css";

/** Estado de erro de `/referencias` (design v2, `Referencias.dc.html`, estado "erro"). */
export default function ErroReferencias({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
        <Botao variante="primario" tamanho="lg" onClick={reset}>
          {textosReferencias.tentarDeNovo}
        </Botao>
      </div>
    </div>
  );
}
