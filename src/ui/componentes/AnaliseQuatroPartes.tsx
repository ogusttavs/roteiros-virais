import type { AvaliacaoResposta } from "@/db/schema";

import styles from "./AnaliseQuatroPartes.module.css";

type Rotulos = { bom: string; melhorar: string; como: string; impacto: string };

type Props = {
  avaliacao: AvaliacaoResposta;
  rotulos: Rotulos;
};

const ORDEM: (keyof Rotulos)[] = ["bom", "melhorar", "como", "impacto"];

/**
 * As partes da avaliacao de uma resposta (briefing-e-rubricas.md, secao 3).
 * O bloco de exemplo (entre "como" e "impacto") so aparece quando
 * `avaliacao.exemplo` existe: avaliacoes gravadas antes da versao 1.2.0 de
 * `avaliarResposta` nao tem esse campo, e continuam validas sem o bloco.
 */
export function AnaliseQuatroPartes({ avaliacao, rotulos }: Props) {
  return (
    <dl className={styles.analise}>
      {ORDEM.map((chave) => (
        <div key={chave} className={styles.parte}>
          <dt className={styles.rotulo}>{rotulos[chave]}</dt>
          <dd className={styles.texto}>{avaliacao[chave]}</dd>
          {chave === "como" && avaliacao.exemplo ? (
            <dd className={styles.exemplo}>
              <p className={styles.textoExemplo}>{avaliacao.exemplo}</p>
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
