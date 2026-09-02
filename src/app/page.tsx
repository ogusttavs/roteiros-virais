import { config } from "@/lib/config";
import { textosInicio } from "@/textos/inicio";
import { Logo } from "@/ui/Logo";

import styles from "./page.module.css";

export default function Inicio() {
  return (
    <main className={styles.pagina}>
      <Logo tamanho={32} />
      <h1>{config.appName}</h1>
      <p className={styles.descricao}>{textosInicio.descricao}</p>
    </main>
  );
}
