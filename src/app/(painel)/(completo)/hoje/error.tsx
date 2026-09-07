"use client";

import { captureException } from "@sentry/nextjs";
import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { textosHoje } from "@/textos/hoje";
import { BarraTopo } from "@/ui/componentes/BarraTopo";

import { HojeCabecalho } from "./HojeCabecalho";
import styles from "./HojeTela.module.css";

/**
 * Estado de erro de `/hoje` (design v2, Hoje.Erro). `captureException` aqui
 * (etapa 13, decisão 1) só manda algo quando o Sentry do navegador existir;
 * nesta rodada, sem `Sentry.init` do lado do cliente, é um no-op seguro que
 * já deixa o ponto certo pronto.
 */
export default function ErroHoje({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <div className={styles.pagina}>
      <BarraTopo titulo={textosHoje.titulo} />
      <div className={styles.conteudo}>
        <HojeCabecalho constancia={{ tipo: "primeiro_dia" }} estado="erro" />
        <div className={styles.estadoCartao}>
          <span className={styles.estadoAviso}>
            <AlertTriangle size={20} strokeWidth={1.75} aria-hidden="true" />
            {textosHoje.erroAviso}
          </span>
          <h3>{textosHoje.erroTitulo}</h3>
          <p>{textosHoje.erro}</p>
          <div className={styles.estadoAcoes}>
            <button type="button" onClick={reset} className={styles.botaoPrimario}>
              {textosHoje.tentarDeNovo}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
