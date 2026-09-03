import styles from "./RoteiroTexto.module.css";

export type BlocoRoteiro = { rotulo: string; paragrafos: string[] };

type Props = {
  blocos: BlocoRoteiro[];
  /** Letra maior, para ler com o celular na mao enquanto grava (entrega/README.md). */
  modoGravacao?: boolean;
};

/**
 * O roteiro diagramado: gancho em destaque, o resto em leitura corrida
 * (RoteiroTela). Maximo 34ch de largura para nao esticar a linha.
 */
export function RoteiroTexto({ blocos, modoGravacao = false }: Props) {
  return (
    <article className={[styles.roteiro, modoGravacao ? styles.gravacao : ""].filter(Boolean).join(" ")}>
      {blocos.map((bloco, indice) => (
        <div key={bloco.rotulo} className={styles.bloco}>
          <span className={styles.rotulo}>{bloco.rotulo}</span>
          {bloco.paragrafos.map((paragrafo, i) => (
            <p key={i} className={indice === 0 && !modoGravacao ? styles.gancho : styles.paragrafo}>
              {paragrafo}
            </p>
          ))}
        </div>
      ))}
    </article>
  );
}
