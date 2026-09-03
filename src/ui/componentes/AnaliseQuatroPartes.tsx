import type { AvaliacaoResposta } from "@/db/schema";

import styles from "./AnaliseQuatroPartes.module.css";

type Rotulos = { bom: string; melhorar: string; como: string; impacto: string };

type Props = {
  avaliacao: AvaliacaoResposta;
  rotulos: Rotulos;
  /**
   * Bloco recuado com um exemplo reescrito, entre "como" e "impacto"
   * (entrega/README.md). Opcional: o schema de avaliacao hoje nao guarda um
   * campo de exemplo separado (so bom, melhorar, como, impacto), entao esta
   * parte so aparece quando quem chama tiver um exemplo para passar.
   */
  exemplo?: string;
};

const ORDEM: (keyof Rotulos)[] = ["bom", "melhorar", "como", "impacto"];

/** As partes da avaliacao de uma resposta (briefing-e-rubricas.md, secao 3). */
export function AnaliseQuatroPartes({ avaliacao, rotulos, exemplo }: Props) {
  return (
    <dl className={styles.analise}>
      {ORDEM.map((chave) => (
        <div key={chave} className={styles.parte}>
          <dt className={styles.rotulo}>{rotulos[chave]}</dt>
          <dd className={styles.texto}>{avaliacao[chave]}</dd>
          {chave === "como" && exemplo ? (
            <dd className={styles.exemplo}>
              <p className={styles.textoExemplo}>{exemplo}</p>
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
