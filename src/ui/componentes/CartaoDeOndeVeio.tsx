import { Play } from "lucide-react";
import type { ReactNode } from "react";

import styles from "./CartaoDeOndeVeio.module.css";

type Props = {
  titulo: string;
  conta: string | null;
  /** "4,1x" */
  multiplo: string;
  /** "acima do normal dessa conta. O que funcionou ali foi..." */
  texto: string;
  segundoFormatado: string | null;
  /** O que aparece na miniatura: o embed de verdade quando dá, um ícone quando não. */
  miniatura?: ReactNode;
  botao?: { rotulo: string; href: string };
  /**
   * A força da evidência (V4, item 6, escopo 5.12): já formatada por quem
   * chama (`textosRoteiro.forcaEvidencia`). Nula sem nada a mostrar; a fraca
   * aparece do mesmo jeito que as outras, escrita sem esconder.
   */
  forca?: string | null;
};

/**
 * "De onde veio": o vídeo de referência do roteiro, com conta e múltiplo
 * reais (design v2, `entrega/telas/Roteiro.dc.html`, `.referencia`;
 * `PROXIMO.md`, D2 parte 1, item 6).
 */
export function CartaoDeOndeVeio({
  titulo,
  conta,
  multiplo,
  texto,
  segundoFormatado,
  miniatura,
  botao,
  forca,
}: Props) {
  return (
    <section className={styles.secao} aria-label={titulo}>
      <h2>{titulo}</h2>
      <div className={styles.linha}>
        <div className={styles.miniatura} aria-hidden={miniatura ? undefined : "true"}>
          {miniatura ?? <Play size={24} strokeWidth={1.5} />}
        </div>
        <div className={styles.corpo}>
          {conta ? <span className={styles.conta}>{conta}</span> : null}
          <p className={styles.texto}>
            <b>{multiplo}</b> {texto}
          </p>
          {segundoFormatado ? <p className={styles.segundo}>{segundoFormatado}</p> : null}
          {forca ? <p className={styles.forca}>{forca}</p> : null}
          {botao ? (
            <a href={botao.href} target="_blank" rel="noreferrer" className={styles.botao}>
              {botao.rotulo}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
