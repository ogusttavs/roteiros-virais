import { RefreshCw } from "lucide-react";

import { textosHoje } from "@/textos/hoje";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { Skeleton } from "@/ui/componentes/Skeleton";

import { HojeCabecalho } from "./HojeCabecalho";
import styles from "./HojeTela.module.css";

/** Esqueleto dos três cartões mais a frase de espera (design v2, Hoje.Carregando). */
export default function CarregandoHoje() {
  return (
    <div className={styles.pagina}>
      <BarraTopo titulo={textosHoje.titulo} />
      <div className={styles.miolo}>
        <HojeCabecalho constancia={{ tipo: "primeiro_dia" }} estado="carregando" />
        <div className={styles.duasColunas}>
          <div className={styles.temasTres}>
            {[0, 1, 2].map((indice) => (
              <div key={indice} className={styles.temaCarregando} aria-busy="true">
                <Skeleton variante="corpo" largura="9rem" />
                <Skeleton variante="titulo" />
                <Skeleton variante="corpo" />
                <Skeleton variante="corpo" largura="80%" />
              </div>
            ))}
          </div>
          <div className={styles.aparte}>
            <p className={styles.esperando}>
              <RefreshCw size={18} strokeWidth={1.75} aria-hidden="true" />
              {textosHoje.carregandoAviso}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
