"use client";

import { Bookmark, ChevronRight, History, Newspaper, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { textosNav } from "@/textos/nav";
import { Folha } from "@/ui/componentes/Folha";

import styles from "./FolhaMais.module.css";

type Props = {
  aoFechar: () => void;
  /** De `useFolhaNoHistorico` de quem abre esta folha (`CapsulaNav.tsx`): fecha pelo histórico E
   * navega, sem os dois brigarem (achado desta rodada: um `<Link>` comum navegava e o `history.back()`
   * do fechamento desfazia a navegação, voltando para a tela de trás). */
  aoNavegar: (navegar: () => void) => void;
};

const ITENS = [
  { href: "/referencias", rotulo: textosNav.referencias, ajuda: textosNav.ajudaReferencias, Icone: Bookmark },
  { href: "/noticias", rotulo: textosNav.noticias, ajuda: textosNav.ajudaNoticias, Icone: Newspaper },
  { href: "/historico", rotulo: textosNav.historico, ajuda: textosNav.ajudaHistorico, Icone: History },
  // A2, item 8: a última da folha; "Mais" acende em /conta (`CapsulaNav.tsx`). O avatar do cabeçalho continua levando à Conta.
  { href: "/conta", rotulo: textosNav.contaEAjustes, ajuda: textosNav.ajudaConta, Icone: UserRound },
];

/**
 * A folha que o "Mais" da cápsula do celular abre (passo 13 do Opus, `Casca.dc.html`, estado
 * `mais`, `.lista-mais`/`.item-mais`): os destinos para consultar, cada um com o que tem lá dentro
 * numa linha. Do tablet para cima eles já estão na barra lateral (`Nav.tsx`), sem esta folha.
 */
export function FolhaMais({ aoFechar, aoNavegar }: Props) {
  const router = useRouter();

  return (
    <Folha titulo={textosNav.mais} aberto aoFechar={aoFechar}>
      <nav className={styles.listaMais} aria-label={textosNav.maisAriaLabelLista}>
        {ITENS.map(({ href, rotulo, ajuda, Icone }) => (
          <Link
            key={href}
            href={href}
            className={styles.itemMais}
            onClick={(evento) => {
              evento.preventDefault();
              aoNavegar(() => router.push(href));
            }}
          >
            <span className={styles.iconeMais} aria-hidden="true">
              <Icone size={22} strokeWidth={1.75} />
            </span>
            <span>
              <strong>{rotulo}</strong>
              <span className={styles.ajudaMais}>{ajuda}</span>
            </span>
            <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        ))}
      </nav>
    </Folha>
  );
}
