import type { LucideIcon } from "lucide-react";

import styles from "./BlocoEdicao.module.css";
import { PorQueAberto, PorQueBotao } from "./PorQue";

export type ItemEdicao = {
  icone: LucideIcon;
  rotulo: string;
  texto: string;
  /** Ex.: o nome do audio da semana, em mono. */
  mono?: string;
  /** E50 parte 2, PR 4: as chaves de bloco do "Por quê" deste item (as frases na tela); o botão e o painel só aparecem dentro de `PorQuesProvider` e se houver por quê. */
  porQueChaves?: string[];
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
                <span className={styles.rotulo}>
                  {item.rotulo}
                  {item.porQueChaves ? <PorQueBotao chaves={item.porQueChaves} id={`pq-edicao-${item.rotulo}`} rotuloDoBloco={item.rotulo} /> : null}
                </span>
                <span className={styles.corpo}>{item.texto}</span>
                {item.mono ? <span className={styles.mono}>{item.mono}</span> : null}
                {item.porQueChaves ? <PorQueAberto chaves={item.porQueChaves} id={`pq-edicao-${item.rotulo}`} /> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
