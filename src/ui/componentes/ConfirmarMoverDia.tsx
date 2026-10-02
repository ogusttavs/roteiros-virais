"use client";

import styles from "./ConfirmarMoverDia.module.css";

type Props = {
  pergunta: string;
  movendo: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
  confirmarRotulo: string;
  cancelarRotulo: string;
};

/**
 * E39c, parte 2b: "soltar num dia que já tem um item do mesmo formato pede confirmação, como o
 * 'mover' já faz" (ordem do Fable). Procurei esse padrão no projeto e não achei nenhum "mover"
 * com confirmação; o mais parecido é a troca de tipo de marca no admin (`SeletorTipoAdmin.tsx`,
 * "no mesmo padrão de 'tirar o acesso'"), que é inline, texto mais os dois botões, sem diálogo
 * à parte. Segui esse padrão aqui (fixo, acima da barra da tela, como o `Toast`, mas com duas
 * ações em vez de uma só com "desfazer"); sinalizado ao Fable ao abrir o PR.
 */
export function ConfirmarMoverDia({ pergunta, movendo, aoConfirmar, aoCancelar, confirmarRotulo, cancelarRotulo }: Props) {
  return (
    <div className={styles.barra} role="alertdialog" aria-labelledby="t-confirmar-mover">
      <p id="t-confirmar-mover" className={styles.pergunta}>
        {pergunta}
      </p>
      <div className={styles.acoes}>
        <button type="button" className={styles.botaoCancelar} disabled={movendo} onClick={aoCancelar}>
          {cancelarRotulo}
        </button>
        <button type="button" className={styles.botaoMover} disabled={movendo} onClick={aoConfirmar}>
          {confirmarRotulo}
        </button>
      </div>
    </div>
  );
}
