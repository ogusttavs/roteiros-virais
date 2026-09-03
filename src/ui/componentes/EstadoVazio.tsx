import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./EstadoVazio.module.css";

type Acao = { rotulo: string } & ({ href: string; onClick?: never } | { href?: never; onClick: () => void });

type Props = {
  /**
   * O icone ja renderizado (`<Video size={24} strokeWidth={1.5} />`), nao o
   * componente. Um componente de icone e uma funcao, e uma funcao nao
   * atravessa a fronteira de servidor para cliente como prop (achado
   * rodando /fundacao, que passa esse icone de uma Server Component);
   * o elemento pronto atravessa sem problema.
   */
  icone: ReactNode;
  frase: string;
  /**
   * href (Link) para so navegar, sem estado nenhum: mantem quem chama como
   * Server Component (/hoje, /historico). onClick exige "use client" em
   * quem chama, pela mesma razao do comentario acima.
   */
  acao?: Acao;
};

/** O que acontece aqui e o proximo passo, nunca "nenhum item" (brief-frontend.md, secao 2). */
export function EstadoVazio({ icone, frase, acao }: Props) {
  return (
    <div className={styles.estado}>
      {icone}
      <p className={styles.frase}>{frase}</p>
      {acao?.href ? (
        <Link href={acao.href} className={styles.acao}>
          {acao.rotulo}
        </Link>
      ) : acao?.onClick ? (
        <button type="button" className={styles.acao} onClick={acao.onClick}>
          {acao.rotulo}
        </button>
      ) : null}
    </div>
  );
}
