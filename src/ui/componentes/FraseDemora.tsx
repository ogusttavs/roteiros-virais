import { textosComuns } from "@/textos/comuns";

import styles from "./FraseDemora.module.css";

/** A linha dos 8 segundos embaixo de um esqueleto (`FraseDemora.module.css`). Fica fora do alcance do leitor de tela até aparecer de fato: `role="status"` anuncia quando o texto surge. */
export function FraseDemora() {
  return (
    <p className={styles.frase} role="status">
      {textosComuns.demorandoMaisQueNormal}
    </p>
  );
}
