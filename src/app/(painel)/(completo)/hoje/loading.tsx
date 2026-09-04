import { textosHoje } from "@/textos/hoje";
import { Progresso } from "@/ui/componentes/Progresso";
import { Skeleton } from "@/ui/componentes/Skeleton";

import styles from "./HojeTela.module.css";

/** Skeleton mais a frase de espera (etapa 10, brief-frontend.md 6.3, estado "carregando"). */
export default function CarregandoHoje() {
  return (
    <div className={styles.pagina}>
      <Skeleton variante="titulo" largura="50%" />
      <Progresso mensagem={textosHoje.carregando} />
      <div className={styles.grade}>
        <Skeleton variante="video" />
        <Skeleton variante="video" />
        <Skeleton variante="video" />
      </div>
    </div>
  );
}
