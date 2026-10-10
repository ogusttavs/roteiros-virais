import styles from "./ChaveLiga.module.css";

type Props = {
  ligada: boolean;
  /** O id do elemento que dá nome à chave (o nome do tipo ao lado); o leitor de tela lê "Passo a passo, ligado". */
  rotuladaPor: string;
  aoTrocar: (ligada: boolean) => void;
  desabilitada?: boolean;
};

/**
 * O desenho da chave sem ser um botão (E41 2c): dentro de um item de menu que já é o botão (`role="menuitemcheckbox"`), a chave só mostra o estado. `aria-hidden`: quem lê é o item.
 */
export function TrilhoDaChave({ ligada }: { ligada: boolean }) {
  return <span aria-hidden="true" data-ligada={ligada} className={`${styles.chave} ${styles.trilho}`} />;
}

/**
 * A chave de ligar e desligar (passo 17 do Opus, `.chave-liga` do `base.css`): `role="switch"`, o trilho de 51 por 31 dentro de um alvo de toque de 56 por 44, a bolinha
 * na mola dos tokens (`--curva-mola`, e sem animação com "reduzir movimento"). Teclado: Espaço e Enter trocam (é um `<button>`); o estado é `aria-checked`.
 */
export function ChaveLiga({ ligada, rotuladaPor, aoTrocar, desabilitada = false }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligada}
      aria-labelledby={rotuladaPor}
      disabled={desabilitada}
      className={styles.chave}
      onClick={() => aoTrocar(!ligada)}
    />
  );
}
