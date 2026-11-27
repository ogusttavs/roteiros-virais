import { PencilLine } from "lucide-react";

import { textosRoteiro } from "@/textos/roteiro";
import { Botao } from "@/ui/componentes/Botao";

import styles from "./AvisoDeColchetes.module.css";

type Props = {
  /** Abre a edição do roteiro (a mesma do botão "Editar" do alto). */
  aoCompletar: () => void;
};

/**
 * 26/11/2026: o aviso curto no alto do roteiro quando a fala tem trecho entre colchetes, o espaço que a IA deixou no lugar de um dado que ela não pode inventar. Os trechos ficam
 * destacados no texto (`TextoComColchetes`); o botão abre a edição para a pessoa trocar cada um pelo dado certo antes de gravar. Não trava o modo gravação.
 */
export function AvisoDeColchetes({ aoCompletar }: Props) {
  const t = textosRoteiro.completarColchetes;
  return (
    <div className={styles.aviso} role="note" aria-labelledby="t-aviso-colchetes" data-aviso-colchetes>
      <span className={styles.titulo} id="t-aviso-colchetes">
        <PencilLine size={18} strokeWidth={1.75} aria-hidden="true" />
        {t.aviso}
      </span>
      <p className={styles.explicacao}>{t.explicacao}</p>
      <Botao type="button" variante="secundario" onClick={aoCompletar} className={styles.botao} data-completar-espacos>
        {t.botao}
      </Botao>
    </div>
  );
}
