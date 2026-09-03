"use client";

import { Bookmark, History, House, List } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

import { textosNav } from "@/textos/nav";

import styles from "./Nav.module.css";
import { ehRotaAtiva } from "./navAtivo";

/**
 * Quatro itens, sem "Conta" (foi para o avatar do cabecalho, decisao do
 * Fable no PROXIMO.md, etapa D parte 1). Base de 64 px no celular, coluna de
 * 220 px no desktop (a largura e da casca, nao deste componente).
 */
const ITENS: { href: string; rotulo: string; Icone: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { href: "/hoje", rotulo: textosNav.hoje, Icone: House },
  { href: "/referencias", rotulo: textosNav.referencias, Icone: Bookmark },
  { href: "/historico", rotulo: textosNav.historico, Icone: History },
  { href: "/briefing", rotulo: textosNav.briefing, Icone: List },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav} aria-label={textosNav.navegacaoPrincipal}>
      {ITENS.map(({ href, rotulo, Icone }) => {
        const ativo = ehRotaAtiva(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={ativo ? `${styles.item} ${styles.ativo}` : styles.item}
            aria-current={ativo ? "page" : undefined}
          >
            <span className={styles.traco} aria-hidden="true" />
            <Icone size={22} strokeWidth={1.5} />
            <span className={styles.rotulo}>{rotulo}</span>
          </Link>
        );
      })}
    </nav>
  );
}
