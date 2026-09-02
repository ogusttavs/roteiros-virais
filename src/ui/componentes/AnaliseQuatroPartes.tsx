import type { AvaliacaoResposta } from "@/db/schema";

import styles from "./AnaliseQuatroPartes.module.css";

type Rotulos = { bom: string; melhorar: string; como: string; impacto: string };

type Props = {
  avaliacao: AvaliacaoResposta;
  rotulos: Rotulos;
};

const ORDEM: (keyof Rotulos)[] = ["bom", "melhorar", "como", "impacto"];

/** As quatro partes da avaliacao de uma resposta (briefing-e-rubricas.md, secao 3). */
export function AnaliseQuatroPartes({ avaliacao, rotulos }: Props) {
  return (
    <dl className={styles.analise}>
      {ORDEM.map((chave) => (
        <div key={chave} className={styles.parte}>
          <dt className={styles.rotulo}>{rotulos[chave]}</dt>
          <dd className={styles.texto}>{avaliacao[chave]}</dd>
        </div>
      ))}
    </dl>
  );
}
