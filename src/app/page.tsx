import { config } from "@/lib/config";
import { textosInicio } from "@/textos/inicio";
import { Simbolo } from "@/ui/Logo";

import styles from "./page.module.css";

export default function Inicio() {
  return (
    <main className={styles.pagina}>
      <Simbolo altura={32} />
      <h1 data-app-name="">{config.appName}</h1>
      <p className={styles.descricao}>{textosInicio.descricao}</p>
    </main>
  );
}
