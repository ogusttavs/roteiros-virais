import { Mic } from "lucide-react";

import type { TomDoBloco } from "@/lib/marcas-de-fala";
import { textosMarcasDeFala } from "@/textos/marcas-de-fala";
import { textosRoteiro } from "@/textos/roteiro";

import { FalaMarcada } from "./FalaMarcada";
import styles from "./RoteiroTexto.module.css";

export type BlocoRoteiro = {
  rotulo: string;
  paragrafos: string[];
  /** E41 parte 2b: os mesmos parágrafos com as marcas de fala (`{p:}`, `{//}`...); só existem com as marcas prontas, e `comMarcas` decide se aparecem. */
  marcado?: string[];
  /** O tom do bloco numa palavra (direto, perto, calmo, firme), na linha "Tom: calmo." embaixo da fala. */
  tom?: TomDoBloco;
  /** O texto na tela deste bloco (Reels), já em frase. */
  mostrar?: string[];
  /** A cena deste bloco (Reels): onde gravar e o que mostrar, junto da fala. */
  cenas?: { momento: string; oQueFazer: string }[];
};

type Props = {
  blocos: BlocoRoteiro[];
  /** Letra maior, para ler com o celular na mao enquanto grava (entrega/README.md). */
  modoGravacao?: boolean;
  /**
   * A leitura do roteiro: cada bloco traz a cena e o texto na tela logo depois da fala ("o que mostrar"), no mesmo cartão (como o Story). Só a tela de leitura liga isto:
   * o teleprompter e o PDF continuam só com a fala.
   */
  comCenas?: boolean;
  /** E41 parte 2b: a fala com as marcas desenhadas e o tom de cada bloco (a chave "Marcas de fala" do roteiro). */
  comMarcas?: boolean;
};

/**
 * O roteiro diagramado: gancho em destaque, o resto em leitura corrida
 * (RoteiroTela). Maximo 34ch de largura para nao esticar a linha.
 */
export function RoteiroTexto({ blocos, modoGravacao = false, comCenas = false, comMarcas = false }: Props) {
  return (
    <article className={[styles.roteiro, modoGravacao ? styles.gravacao : ""].filter(Boolean).join(" ")}>
      {blocos.map((bloco, indice) => (
        <div key={bloco.rotulo} className={[styles.bloco, comCenas && (bloco.cenas?.length || bloco.mostrar?.length) ? styles.comCena : ""].filter(Boolean).join(" ")} data-bloco-de-fala>
          <span className={styles.rotulo}>{bloco.rotulo}</span>
          <div className={styles.fala}>
            {bloco.paragrafos.map((paragrafo, i) => (
              <p key={i} className={indice === 0 && !modoGravacao ? styles.gancho : styles.paragrafo}>
                {comMarcas && bloco.marcado && bloco.marcado.length === bloco.paragrafos.length ? <FalaMarcada marcado={bloco.marcado[i]} /> : paragrafo}
              </p>
            ))}
            {comMarcas && bloco.marcado && bloco.tom ? (
              <p className={styles.comoFalar} data-tom-do-bloco={bloco.tom}>
                <Mic size={16} strokeWidth={1.75} aria-hidden="true" />
                <span>
                  <b>{textosMarcasDeFala.tom.rotulo(bloco.tom)}</b> {textosMarcasDeFala.tom.dica[bloco.tom]}
                </span>
              </p>
            ) : null}
          </div>
          {comCenas && (bloco.cenas?.length || bloco.mostrar?.length) ? (
            <div className={styles.cena} data-cena-do-bloco>
              <span className={styles.rotuloCena}>{textosRoteiro.cartaoStory.oQueMostrar}</span>
              {(bloco.cenas ?? []).map((cena, i) => (
                <p key={`c${i}`} className={styles.textoCena}>
                  <span className={styles.momentoCena}>{cena.momento}</span> {cena.oQueFazer}
                </p>
              ))}
              {(bloco.mostrar ?? []).map((linha, i) => (
                <p key={`m${i}`} className={styles.textoCena}>
                  {linha}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </article>
  );
}
