import type { LucideIcon } from "lucide-react";

import styles from "./BlocoEdicao.module.css";

export type ItemEdicao = {
  icone: LucideIcon;
  rotulo: string;
  texto: string;
  /** Ex.: o nome do audio da semana, em mono. */
  mono?: string;
};

type Props = {
  titulo: string;
  itens: ItemEdicao[];
};

/** Como editar: texto na tela, ritmo de corte, recursos, audio (RoteiroTela). */
export function BlocoEdicao({ titulo, itens }: Props) {
  return (
    <section className={styles.secao}>
      <h2 className={styles.titulo}>{titulo}</h2>
      <ul className={styles.lista}>
        {itens.map((item) => {
          const Icone = item.icone;
          return (
            <li key={item.rotulo} className={styles.item}>
              <Icone size={20} strokeWidth={1.5} className={styles.icone} aria-hidden="true" />
              <div className={styles.texto}>
                <span className={styles.rotulo}>{item.rotulo}</span>
                <span className={styles.corpo}>{item.texto}</span>
                {item.mono ? <span className={styles.mono}>{item.mono}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
