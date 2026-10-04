"use client";

import { Coins, Cog, Home, Layers, Sparkles, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import styles from "./LateralAdmin.module.css";

type Destino = "inicio" | "clientes" | "nichos" | "jobs" | "geracoes" | "custos";

const DESTINOS: { chave: Destino; href: string; Icone: LucideIcon }[] = [
  { chave: "inicio", href: "/admin", Icone: Home },
  { chave: "clientes", href: "/admin/clientes", Icone: Users },
  { chave: "nichos", href: "/admin/nichos", Icone: Layers },
  { chave: "jobs", href: "/admin/jobs", Icone: Cog },
  { chave: "geracoes", href: "/admin/geracoes", Icone: Sparkles },
  { chave: "custos", href: "/admin/custos", Icone: Coins },
];

/**
 * A barra lateral do admin (E46 PR 1, `Casca.dc.html` e `casca.js`, `montarAdmin`): Início, Contas, Ramos, Rotinas, Gerações e Viagem, mais "sair" no pé. A 1180 px ou menos
 * recolhe para só os ícones. O Início só fica ativo na própria rota (as outras começam por `/admin/`).
 */
export function LateralAdmin({
  rotulos,
  selos = {},
  nomeDoAdmin,
  rodape,
  marca,
  selo,
}: {
  rotulos: Record<Destino, string>;
  /** Um número ao lado do rótulo (os pedidos de ramo abertos, ao lado de "Ramos"), com a frase que o leitor de tela lê. */
  selos?: Partial<Record<Destino, { quantos: number; descricao: string }>>;
  nomeDoAdmin: string;
  rodape: ReactNode;
  marca: ReactNode;
  selo: string;
}) {
  const pathname = usePathname() ?? "";
  return (
    <aside className={styles.lateral}>
      <div className={styles.marca}>
        {marca}
        <span className={styles.selo}>{selo}</span>
      </div>
      <nav aria-label="Seções do admin" className={styles.nav}>
        {DESTINOS.map(({ chave, href, Icone }) => {
          const ativo = chave === "inicio" ? pathname === "/admin" : pathname.startsWith(href);
          const seloDoItem = selos[chave];
          return (
            <Link key={chave} href={href} aria-current={ativo ? "page" : undefined} title={rotulos[chave]} className={[styles.item, ativo ? styles.ativo : ""].filter(Boolean).join(" ")}>
              <Icone size={20} strokeWidth={1.5} aria-hidden="true" />
              <span className={styles.rotulo}>{rotulos[chave]}</span>
              {seloDoItem && seloDoItem.quantos > 0 ? (
                <span className={styles.numero} role="img" aria-label={seloDoItem.descricao}>
                  {seloDoItem.quantos}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className={styles.pe}>
        <span className={styles.nomeDoAdmin}>{nomeDoAdmin}</span>
        {rodape}
      </div>
    </aside>
  );
}
