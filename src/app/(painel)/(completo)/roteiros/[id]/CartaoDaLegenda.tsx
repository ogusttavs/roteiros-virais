/**
 * O cartão "Legenda do post" do roteiro (sem fala e Story), com copiar. E70: mostra e copia a legenda do modelo SEM as hashtags (`legendaSemHashtags`); as hashtags ficam só no
 * bloco "Hashtags para colar" (`HashtagsParaColar`), escolhidas pelo código, para nunca aparecerem duas listas nem uma hashtag com promessa escrita pelo modelo. Legenda que era só
 * hashtag some, como a legenda vazia.
 */
import { Copy } from "lucide-react";

import { legendaSemHashtags } from "@/lib/formatar-video-referencia";
import { textosRoteiro } from "@/textos/roteiro";

import styles from "./RoteiroTela.module.css";

type Props = {
  legenda: string | null | undefined;
  aoCopiar: () => void;
  aoFalhar: () => void;
};

export function CartaoDaLegenda({ legenda, aoCopiar, aoFalhar }: Props) {
  const texto = legendaSemHashtags(legenda);
  if (!texto) return null;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      aoCopiar();
    } catch {
      aoFalhar();
    }
  }

  return (
    <section className={styles.referenciaVazia}>
      <h2>{textosRoteiro.legenda}</h2>
      <p>{texto}</p>
      <button type="button" onClick={() => void copiar()} className={styles.linkReprovar}>
        <Copy size={16} strokeWidth={1.5} aria-hidden="true" />
        {textosRoteiro.menu.copiarLegenda}
      </button>
    </section>
  );
}
