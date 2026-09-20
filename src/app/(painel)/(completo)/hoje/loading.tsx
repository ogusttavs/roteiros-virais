import { textosHoje } from "@/textos/hoje";
import { BarraTopo } from "@/ui/componentes/BarraTopo";

import { HojeCabecalho } from "./HojeCabecalho";
import { HojeEsqueleto } from "./HojeEsqueleto";
import styles from "./HojeTela.module.css";

/** Esqueleto dos três cartões mais a frase de espera (design v2, Hoje.Carregando). */
export default function CarregandoHoje() {
  return (
    <div className={styles.pagina}>
      <BarraTopo titulo={textosHoje.titulo} />
      <div className={styles.miolo}>
        <HojeCabecalho constancia={{ tipo: "primeiro_dia" }} estado="carregando" />
        <HojeEsqueleto mensagemEsperando={textosHoje.carregandoAviso} />
      </div>
    </div>
  );
}
