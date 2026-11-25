/**
 * E70: o bloco "Hashtags para colar" do roteiro, com o botão de copiar. Sem hashtag nenhuma o bloco não existe (a escolha é de `hashtagsDoPost`, que devolve
 * menos, ou nada, quando o banco não tem dado suficiente). A cópia é do aparelho e não chama o servidor.
 */
import { Copy } from "lucide-react";

import { textosRoteiro } from "@/textos/roteiro";

import styles from "./RoteiroTela.module.css";

type Props = {
  hashtags: string[];
  aoCopiar: () => void;
  aoFalhar: () => void;
};

export function HashtagsParaColar({ hashtags, aoCopiar, aoFalhar }: Props) {
  if (hashtags.length === 0) return null;
  const texto = hashtags.join(" ");

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      aoCopiar();
    } catch {
      aoFalhar();
    }
  }

  return (
    <section className={styles.referenciaVazia} data-hashtags-do-post>
      <h2>{textosRoteiro.hashtags.titulo}</h2>
      <p>{texto}</p>
      <button type="button" onClick={() => void copiar()} className={styles.linkReprovar}>
        <Copy size={16} strokeWidth={1.5} aria-hidden="true" />
        {textosRoteiro.hashtags.copiar}
      </button>
      <p className={styles.notaDasHashtags}>{textosRoteiro.hashtags.nota}</p>
    </section>
  );
}
