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
  /**
   * P1, item 8 (achado do Gustavo: o exemplo de "como melhorar" foi lido
   * como a própria resposta da pessoa): rótulo visível de sugestão e o botão
   * "Usar esta sugestão". Sem isto (a vitrine em `fundacao/page.tsx`), o
   * exemplo aparece só com aspas, sem rótulo nem botão.
   */
  sugestao?: { rotulo: string; botaoUsar: string; onUsar: () => void };
};

const ORDEM: (keyof Rotulos)[] = ["bom", "melhorar", "como", "impacto"];
const CLASSE_FAIXA = { naMeta: "naMeta", neutra: "neutra", baixa: "baixa" } as const;

function formatarNota(valor: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * As partes da avaliacao de uma resposta (briefing-e-rubricas.md, secao 3),
 * com a nota e a faixa no topo do cartao, no mesmo bloco (design v2,
 * `entrega/telas/base.css`, ".analise"; `Comecar.dc.html`). O bloco de
 * exemplo (entre "como" e "impacto") so aparece quando `avaliacao.exemplo`
 * existe: avaliacoes gravadas antes da versao 1.2.0 de `avaliarResposta` nao
 * tem esse campo, e continuam validas sem o bloco.
 */
export function AnaliseQuatroPartes({ avaliacao, rotulos, meta, rotulosFaixa, sugestao }: Props) {
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
            {chave === "como" && avaliacao.exemplo ? (
              <dd className={styles.exemplo}>
                {sugestao ? <p className={styles.rotuloSugestao}>{sugestao.rotulo}</p> : null}
                <p className={styles.textoExemplo}>“{avaliacao.exemplo}”</p>
                {sugestao ? (
                  <button type="button" className={styles.botaoUsarSugestao} onClick={sugestao.onUsar}>
                    {sugestao.botaoUsar}
                  </button>
                ) : null}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </div>
  );
}
