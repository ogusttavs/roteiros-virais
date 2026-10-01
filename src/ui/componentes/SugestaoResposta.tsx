import { Botao } from "./Botao";
import styles from "./SugestaoResposta.module.css";

type Props = {
  rotulo: string;
  exemplo: string;
  aviso: string;
  botaoUsar: string;
  onUsar: () => void;
};

/**
 * E37a, item 2 (achado do Gustavo e do Bruno: a sugestão parecia a resposta da pessoa, por usar o
 * mesmo visual de campo): nunca borda de campo, nunca `textarea`, fundo de apoio, rótulo e aviso
 * fixo acima do botão. Separado de `AnaliseQuatroPartes` (que só mostra "o que está bom", "o que
 * pode melhorar", "como melhorar" e "impacto"; o exemplo de "como melhorar" morava lá, agora mora
 * só aqui).
 */
export function SugestaoResposta({ rotulo, exemplo, aviso, botaoUsar, onUsar }: Props) {
  return (
    <div className={styles.sugestao}>
      <span className={styles.rotulo}>{rotulo}</span>
      <p className={styles.texto}>{exemplo}</p>
      <p className={styles.aviso}>{aviso}</p>
      <Botao variante="ghost" onClick={onUsar}>
        {botaoUsar}
      </Botao>
    </div>
  );
}
