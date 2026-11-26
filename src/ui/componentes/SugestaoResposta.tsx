import { temColchete } from "@/carrossel/colchetes";

import { Botao } from "./Botao";
import { TextoComColchetes } from "./Colchetes";
import styles from "./SugestaoResposta.module.css";

type Props = {
  rotulo: string;
  exemplo: string;
  aviso: string;
  botaoUsar: string;
  onUsar: () => void;
  /**
   * E76 PR 1: a sugestão com um trecho entre colchetes (o dado que só a pessoa sabe) mostra o trecho destacado, este aviso e
   * `botaoUsarComColchete` no lugar de `botaoUsar`. Sem colchete, nada muda.
   */
  avisoColchete?: string;
  botaoUsarComColchete?: string;
};

/**
 * E37a, item 2 (achado do Gustavo e do Bruno: a sugestão parecia a resposta da pessoa, por usar o
 * mesmo visual de campo): nunca borda de campo, nunca `textarea`, fundo de apoio, rótulo e aviso
 * fixo acima do botão. Separado de `AnaliseQuatroPartes` (que só mostra "o que está bom", "o que
 * pode melhorar", "como melhorar" e "impacto"; o exemplo de "como melhorar" morava lá, agora mora
 * só aqui).
 */
export function SugestaoResposta({ rotulo, exemplo, aviso, botaoUsar, onUsar, avisoColchete, botaoUsarComColchete }: Props) {
  const comColchete = temColchete(exemplo);
  return (
    <div className={styles.sugestao}>
      <span className={styles.rotulo}>{rotulo}</span>
      <p className={styles.texto}>
        <TextoComColchetes texto={exemplo} />
      </p>
      <p className={styles.aviso}>{aviso}</p>
      {comColchete && avisoColchete ? <p className={styles.aviso}>{avisoColchete}</p> : null}
      <Botao variante="ghost" onClick={onUsar}>
        {comColchete && botaoUsarComColchete ? botaoUsarComColchete : botaoUsar}
      </Botao>
    </div>
  );
}
