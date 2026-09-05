import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { iniciaisDe } from "@/lib/iniciais";
import { sessaoAtual } from "@/lib/sessao";
import { textosAdmin } from "@/textos/admin";
import { Logo } from "@/ui/Logo";

import { AbasAdmin } from "./_casca/AbasAdmin";
import styles from "./layout.module.css";

const t = textosAdmin.navegacao;

/** Casca do admin: abas, largura total, sem a navegacao do cliente (CascaAdmin.dc.html). */
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
      <header className={styles.cabecalho}>
        <div className={styles.identidade}>
          <Logo tamanho={24} />
          <span className={styles.equipe}>{t.equipe}</span>
        </div>
        <AbasAdmin rotulos={{ clientes: t.clientes, nichos: t.nichos, jobs: t.jobs, geracoes: t.geracoes }} />
        <div className={styles.conta}>
          <span className={styles.nomeConta}>{sessao.user.name}</span>
          <span className={styles.avatar}>{iniciaisDe(sessao.user.name)}</span>
        </div>
      </header>
      <main className={styles.corpo}>{children}</main>
    </div>
  );
}
