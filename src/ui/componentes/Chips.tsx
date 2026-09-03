import styles from "./Chips.module.css";
import { chipsAtivos } from "./chipsAtivo";

type Props = {
  rotuloGrupo: string;
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
export function Chips({ rotuloGrupo, opcoes, selecionado, onChange }: Props) {
  const ativos = chipsAtivos(opcoes.length, selecionado);

  return (
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
}

/** Separador entre grupos de Chips numa mesma linha (entrega/README.md). */
export function SeparadorChips() {
  return <span aria-hidden="true" className={styles.separador} />;
}
