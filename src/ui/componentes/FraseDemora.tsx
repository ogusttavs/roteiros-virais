import { textosComuns } from "@/textos/comuns";

import styles from "./FraseDemora.module.css";

/** A linha dos 8 segundos embaixo de um esqueleto (`FraseDemora.module.css`). O leitor de tela anuncia quando o texto surge (`role="status"`). */
export function FraseDemora() {
  return (
    <p className={styles.frase} role="status">
      {textosComuns.demorandoMaisQueNormal}
    </p>
  );
}
