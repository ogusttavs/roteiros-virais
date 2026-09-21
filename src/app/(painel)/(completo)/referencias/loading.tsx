import { Skeleton } from "@/ui/componentes/Skeleton";

import styles from "./ReferenciasTela.module.css";

/** Skeleton de `/referencias` (V6, `Referencias.dc.html`, estado "carregando"). */
export default function CarregandoReferencias() {
  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalhoTela}>
        <Skeleton variante="titulo" largura="60%" />
      </div>
      <div className={styles.grade}>
        <Skeleton variante="video" />
        <Skeleton variante="video" />
        <Skeleton variante="video" />
      </div>
    </div>
  );
}
