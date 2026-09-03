import styles from "./BarraAcao.module.css";

export type AcaoBarra = { rotulo: string; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean };

type Props = {
  primaria: AcaoBarra;
  secundaria?: AcaoBarra;
};

/**
 * Barra fixa na base no celular, com um ou dois botoes (entrega/README.md,
 * "BarraAcao": nao esta no README, nome registrado em TODO.md porque as
 * telas usam mas a entrega nao documentou). As telas da parte 2 usam isto
 * dentro da casca; aqui e so o componente.
 */
export function BarraAcao({ primaria, secundaria }: Props) {
  return (
    <div className={styles.barra}>
      <div className={styles.botoes}>
        {secundaria ? (
          <button
            type={secundaria.type ?? "button"}
            onClick={secundaria.onClick}
            disabled={secundaria.disabled}
            className={styles.secundaria}
          >
            {secundaria.rotulo}
          </button>
        ) : null}
        <button
          type={primaria.type ?? "button"}
          onClick={primaria.onClick}
          disabled={primaria.disabled}
          className={styles.primaria}
        >
          {primaria.rotulo}
        </button>
      </div>
    </div>
  );
}
