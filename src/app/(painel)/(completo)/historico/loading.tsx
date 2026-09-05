import { Skeleton } from "@/ui/componentes/Skeleton";

import styles from "./HistoricoTela.module.css";

/** Skeleton de `/historico` (etapa 12, `HistoricoTela.dc.html`, estado "carregando"). */
export default function CarregandoHistorico() {
  return (
    <div className={styles.pagina}>
      <Skeleton variante="titulo" largura="40%" />
      <div className={styles.numerosCarregando}>
        <Skeleton variante="numero" largura="48px" />
        <Skeleton variante="numero" largura="48px" />
        <Skeleton variante="numero" largura="48px" />
      </div>
      <Skeleton variante="corpo" largura="90%" />
      <Skeleton variante="corpo" largura="90%" />
    </div>
  );
}
