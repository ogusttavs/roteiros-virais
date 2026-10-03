"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./AbasAdmin.module.css";

const ABAS = [
  { href: "/admin/clientes", rotuloChave: "clientes" as const },
  { href: "/admin/nichos", rotuloChave: "nichos" as const },
  { href: "/admin/jobs", rotuloChave: "jobs" as const },
  { href: "/admin/geracoes", rotuloChave: "geracoes" as const },
  { href: "/admin/viagem", rotuloChave: "viagem" as const },
];

/** Abas do admin com o traco embaixo da ativa (CascaAdmin.dc.html). */
export function AbasAdmin({
  rotulos,
  selos = {},
}: {
  rotulos: Record<"clientes" | "nichos" | "jobs" | "geracoes" | "viagem", string>;
  /** E45 PR 2: um número ao lado do rótulo (os pedidos de ramo abertos, ao lado de "Nichos"), com a frase que o leitor de tela lê. */
  selos?: Partial<Record<"clientes" | "nichos" | "jobs" | "geracoes" | "viagem", { quantos: number; descricao: string }>>;
}) {
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
            {selos[rotuloChave] && selos[rotuloChave]!.quantos > 0 ? (
              <span className={styles.selo} role="img" aria-label={selos[rotuloChave]!.descricao}>
                {selos[rotuloChave]!.quantos}
              </span>
            ) : null}
            <span className={styles.traco} aria-hidden="true" />
          </Link>
        );
      })}
    </nav>
  );
}
