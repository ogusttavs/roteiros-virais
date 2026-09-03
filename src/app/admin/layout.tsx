import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { sessaoAtual } from "@/lib/sessao";
import { textosAdmin } from "@/textos/admin";

import styles from "./layout.module.css";

const t = textosAdmin.navegacao;

/** Area da equipe, sem a barra do cliente (brief-frontend.md, 6.10). */
export default async function LayoutAdmin({ children }: { children: ReactNode }) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }
  if (sessao.user.role !== "admin") {
    redirect("/hoje");
  }

  return (
    <div className={styles.pagina}>
      <nav className={styles.nav}>
        <Link href="/admin/clientes">{t.clientes}</Link>
        <Link href="/admin/nichos">{t.nichos}</Link>
        <Link href="/admin/jobs">{t.jobs}</Link>
      </nav>
      {children}
    </div>
  );
}
