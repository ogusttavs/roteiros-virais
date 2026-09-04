import { Skeleton } from "@/ui/componentes/Skeleton";

import styles from "./ReferenciasTela.module.css";

/** Skeleton de `/referencias` (etapa 12, `ReferenciasTela.dc.html`, estado "carregando"). */
export default function CarregandoReferencias() {
  return (
    <div className={styles.pagina}>
      <Skeleton variante="titulo" largura="40%" />
      <div className={styles.grade}>
        <Skeleton variante="video" />
        <Skeleton variante="video" />
        <Skeleton variante="video" />
      </div>
    </div>
  );
}
