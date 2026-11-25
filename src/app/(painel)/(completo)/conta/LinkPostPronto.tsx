import Link from "next/link";

import { textosPostPronto } from "@/textos/post-pronto";
import { Cartao } from "@/ui/componentes/Cartao";

import styles from "./LinkPostPronto.module.css";

const t = textosPostPronto.tela;

/** E56 PR 2: a entrada de "Publicar post pronto", logo abaixo de "Seu Instagram". Só aparece com a chave aberta, com o Instagram ligado e para quem pode publicar (a dona da marca, fora do "ver como"). */
export function LinkPostPronto() {
  return (
    <Cartao className={styles.cartao} data-testid="link-post-pronto">
      <p className={styles.texto}>{t.entradaAjuda}</p>
      <Link href="/publicar-post" className={styles.link}>
        {t.entrada}
      </Link>
    </Cartao>
  );
}
