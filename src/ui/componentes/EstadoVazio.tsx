import type { ReactNode } from "react";

import styles from "./EstadoVazio.module.css";

type Props = {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
};

export function EstadoVazio({ titulo, descricao, acao }: Props) {
  return (
    <div className={styles.estado}>
      <p className={styles.titulo}>{titulo}</p>
      {descricao ? <p className={styles.descricao}>{descricao}</p> : null}
      {acao}
    </div>
  );
}
