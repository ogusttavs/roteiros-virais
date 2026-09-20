import { RefreshCw } from "lucide-react";

import { Skeleton } from "@/ui/componentes/Skeleton";

import styles from "./HojeTela.module.css";

/**
 * Os três cartões de tema em esqueleto mais a frase de espera do aparte
 * (design v2, `Hoje.dc.html`, estado `carregando`; `Casca.dc.html`, estado
 * `trocando`): os dois usam a mesma casca visual, só a frase muda (`loading.tsx`
 * para o carregamento da rota, `HojeTela.tsx` para a troca de marca em
 * andamento).
 */
export function HojeEsqueleto({ mensagemEsperando }: { mensagemEsperando: string }) {
  return (
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
          {mensagemEsperando}
        </p>
      </div>
    </div>
  );
}
