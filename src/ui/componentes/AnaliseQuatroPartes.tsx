import type { AvaliacaoResposta } from "@/db/schema";

import styles from "./AnaliseQuatroPartes.module.css";
import { faixaMeta } from "./notaFaixaMeta";

type Rotulos = { bom: string; melhorar: string; como: string; impacto: string };
type RotulosFaixa = { naMeta: string; neutra: string; baixa: string };

type Props = {
  avaliacao: AvaliacaoResposta;
  rotulos: Rotulos;
  /** Meta da nota (design v2, `base.css`, ".analise"): pinta o topo e escolhe a palavra da faixa. */
  meta: number;
  rotulosFaixa: RotulosFaixa;
};

const ORDEM: (keyof Rotulos)[] = ["bom", "melhorar", "como", "impacto"];
const CLASSE_FAIXA = { naMeta: "naMeta", neutra: "neutra", baixa: "baixa" } as const;

function formatarNota(valor: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * As partes da avaliacao de uma resposta (briefing-e-rubricas.md, secao 3),
 * com a nota e a faixa no topo do cartao, no mesmo bloco (design v2,
 * `entrega/telas/base.css`, ".analise"; `Comecar.dc.html`). O exemplo de
 * "como melhorar" (`avaliacao.exemplo`) nao aparece mais aqui (E37a, item 2:
 * virar a propria resposta lida como se fosse da pessoa); ele mora so em
 * `SugestaoResposta`, fora deste componente.
 */
export function AnaliseQuatroPartes({ avaliacao, rotulos, meta, rotulosFaixa }: Props) {
  const faixa = faixaMeta(avaliacao.nota, meta);
  return (
    <div className={[styles.analise, styles[CLASSE_FAIXA[faixa]]].join(" ")}>
      <div className={styles.topo}>
        <span className={styles.valor}>{formatarNota(avaliacao.nota)}</span>
        <span className={styles.faixa}>{rotulosFaixa[faixa]}</span>
      </div>
      <dl className={styles.partes}>
        {ORDEM.map((chave) => (
          <div key={chave} className={styles.parte}>
            <dt className={styles.rotulo}>{rotulos[chave]}</dt>
            <dd className={styles.texto}>{avaliacao[chave]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
