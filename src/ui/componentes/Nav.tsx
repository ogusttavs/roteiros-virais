"use client";

import { ClipboardList, History, Home, User, Video } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

import { textosNav } from "@/textos/nav";

import styles from "./Nav.module.css";

const ITENS: { href: string; rotulo: string; Icone: ComponentType<{ size?: number }> }[] = [
  { href: "/hoje", rotulo: textosNav.hoje, Icone: Home },
  { href: "/referencias", rotulo: textosNav.referencias, Icone: Video },
  { href: "/historico", rotulo: textosNav.historico, Icone: History },
  { href: "/briefing", rotulo: textosNav.briefing, Icone: ClipboardList },
  { href: "/conta", rotulo: textosNav.conta, Icone: User },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav} aria-label={textosNav.navegacaoPrincipal}>
      {ITENS.map(({ href, rotulo, Icone }) => {
        const ativo = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={ativo ? `${styles.item} ${styles.ativo}` : styles.item}
            aria-current={ativo ? "page" : undefined}
          >
            <Icone size={22} />
            <span>{rotulo}</span>
          </Link>
        );
      })}
    </nav>
  );
}
