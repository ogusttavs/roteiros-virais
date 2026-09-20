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

type Props = {
  /**
   * Só a barra lateral do desktop passa isto (etapa "acabamento visual 2"):
   * marca o `<nav>` para o CSS poder esconder o rótulo quando a barra está
   * recolhida (`html[data-barra-lateral="recolhida"]`), sem afetar a barra
   * inferior do celular, que usa o mesmo componente sem a prop.
   */
  compactavel?: boolean;
  /**
   * Só a cápsula do celular passa isto (V5, item 5, `CapsulaAbas.tsx`): o
   * rótulo escrito some da vista ao rolar para baixo, mas continua para o
   * leitor de tela (`.escondidoDaVista`, não `display: none`, diferente de
   * `compactavel` acima, que tem o `title` como alternativa de tooltip).
   */
  encolhida?: boolean;
};

export function Nav({ compactavel = false, encolhida = false }: Props) {
  const pathname = usePathname();

  const classes = [styles.nav, compactavel && styles.compactavel, encolhida && styles.navEncolhida]
    .filter(Boolean)
    .join(" ");

  return (
    <nav className={classes} aria-label={textosNav.navegacaoPrincipal}>
      {ITENS.map(({ href, rotulo, Icone }) => {
        const ativo = ehRotaAtiva(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={ativo ? `${styles.item} ${styles.ativo}` : styles.item}
            aria-current={ativo ? "page" : undefined}
            title={compactavel ? rotulo : undefined}
          >
            <span className={styles.traco} aria-hidden="true" />
            <Icone size={22} strokeWidth={1.5} />
            <span className={encolhida ? `${styles.rotulo} ${styles.escondidoDaVista}` : styles.rotulo}>
              {rotulo}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
