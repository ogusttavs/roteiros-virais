"use client";

import styles from "./Chips.module.css";
import { chipsAtivos } from "./chipsAtivo";

type Props = {
  rotuloGrupo: string;
  /**
   * Rotulo visivel acima dos chips, no mesmo estilo dos outros rotulos de
   * grupo da tela (V12b, item 6: achado do Gustavo em producao, sem um
   * rotulo visivel a pessoa nao entendia o que a fileira de chips era, so
   * `rotuloGrupo` no `aria-label` nao aparece na tela). Opcional: sem ele,
   * o grupo continua so com o `aria-label`, como sempre foi.
   */
  rotuloVisivel?: string;
  opcoes: string[];
  /** Indice da opcao marcada, ou nulo se nenhuma (grupo de filtro opcional). */
  selecionado: number | null;
  onChange: (indice: number) => void;
};

/**
 * Um grupo de filtros com uma opcao marcada por vez (entrega/README.md).
 * Uma tela com varios grupos (ReferenciasTela) compoe varias instancias lado
 * a lado, com um separador entre elas.
 */
export function Chips({ rotuloGrupo, rotuloVisivel, opcoes, selecionado, onChange }: Props) {
  const ativos = chipsAtivos(opcoes.length, selecionado);

  const grupo = (
    <div role="group" aria-label={rotuloGrupo} className={styles.grupo}>
      {opcoes.map((rotulo, indice) => {
        const ativo = ativos[indice];
        return (
          <button
            key={rotulo}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(indice)}
            className={[styles.chip, ativo ? styles.ativo : ""].filter(Boolean).join(" ")}
          >
            {rotulo}
          </button>
        );
      })}
    </div>
  );

  /**
   * So embrulha num bloco empilhado (rotulo em cima) quando `rotuloVisivel`
   * e passado: os outros usos (Referencias, fundacao/page.tsx) poem varios
   * Chips lado a lado com SeparadorChips entre eles, e um embrulho sempre
   * presente quebraria essa fileira (`.grupo` e `inline-flex`, um `<div>`
   * novo por fora seria `block` e forcaria cada grupo para a propria linha).
   */
  if (!rotuloVisivel) return grupo;

  return (
    <div className={styles.bloco}>
      <span className={styles.rotulo}>{rotuloVisivel}</span>
      {grupo}
    </div>
  );
}

/** Separador entre grupos de Chips numa mesma linha (entrega/README.md). */
export function SeparadorChips() {
  return <span aria-hidden="true" className={styles.separador} />;
}
