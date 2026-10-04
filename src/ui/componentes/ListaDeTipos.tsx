import { FORMATOS_DO_CATALOGO } from "@/config/formatos";
import { textosTipos } from "@/textos/tipos";

import { ChaveLiga } from "./ChaveLiga";
import styles from "./ListaDeTipos.module.css";

type Props = {
  /** Ligada ou desligada, por chave. */
  estado: Readonly<Record<string, boolean>>;
  aoTrocar: (chave: string, ligada: boolean) => void;
  /** Para os ids do rótulo não se repetirem quando há duas listas na mesma página. */
  sufixo?: string;
};

/**
 * A lista dos treze tipos de vídeo do cliente (passo 17 do Opus, `listaFormatos` de `casca.js`): na ordem do estudo (a chave ligar ou desligar nunca muda a ordem), cada
 * um com o nome, a frase, "Por exemplo:" (a frase fixa de `config/formatos.ts`) e a chave de ligar. O que o cliente trocou em relação ao padrão vem marcado de leve ("você
 * ligou", "você desligou").
 */
export function ListaDeTipos({ estado, aoTrocar, sufixo = "" }: Props) {
  return (
    <ul className={styles.lista} aria-label={textosTipos.rotuloLista}>
      {FORMATOS_DO_CATALOGO.map((tipo) => {
        const ligada = estado[tipo.chave] ?? tipo.ligadaPorPadrao;
        const trocou = ligada !== tipo.ligadaPorPadrao;
        const id = `tipo-${tipo.chave}${sufixo}`;
        return (
          <li key={tipo.chave} className={styles.tipo} data-tipo={tipo.chave}>
            <span className={styles.texto}>
              <span className={styles.nome} id={id}>
                {tipo.nome}
                {trocou ? <span className={styles.trocou}>{ligada ? textosTipos.voceLigou : textosTipos.voceDesligou}</span> : null}
              </span>
              <span className={styles.frase}>{tipo.frase}</span>
              <span className={styles.exemplo}>
                {textosTipos.porExemplo} {tipo.exemplo}
              </span>
            </span>
            <ChaveLiga ligada={ligada} rotuladaPor={id} aoTrocar={(nova) => aoTrocar(tipo.chave, nova)} />
          </li>
        );
      })}
    </ul>
  );
}
