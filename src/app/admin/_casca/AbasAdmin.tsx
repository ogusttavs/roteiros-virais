"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./AbasAdmin.module.css";

const ABAS = [
  { href: "/admin/clientes", rotuloChave: "clientes" as const },
  { href: "/admin/nichos", rotuloChave: "nichos" as const },
  { href: "/admin/jobs", rotuloChave: "jobs" as const },
  { href: "/admin/geracoes", rotuloChave: "geracoes" as const },
];

/** Abas do admin com o traco embaixo da ativa (CascaAdmin.dc.html). */
export function AbasAdmin({ rotulos }: { rotulos: Record<"clientes" | "nichos" | "jobs" | "geracoes", string> }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Seções do admin" className={styles.nav}>
      {ABAS.map(({ href, rotuloChave }) => {
        const ativo = pathname?.startsWith(href) ?? false;
        return (
          <Link
            key={href}
            href={href}
            aria-current={ativo ? "page" : undefined}
            className={[styles.aba, ativo ? styles.ativo : ""].filter(Boolean).join(" ")}
          >
            {rotulos[rotuloChave]}
            <span className={styles.traco} aria-hidden="true" />
          </Link>
        );
      })}
    </nav>
  );
}
