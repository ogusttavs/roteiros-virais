import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { textosNav } from "@/textos/nav";
import { Nav } from "@/ui/componentes/Nav";
import { Logo } from "@/ui/Logo";

import { CabecalhoCelular } from "./_casca/CabecalhoCelular";
import styles from "./layout.module.css";

function iniciaisDe(nome: string): string {
  return (nome.trim()[0] ?? "?").toUpperCase();
}

/**
 * Casca do cliente (CascaCelular.dc.html, CascaDesktop.dc.html): cabecalho
 * que some ao rolar mais barra inferior no celular; coluna de 220 px com a
 * conta na base no desktop. A conta saiu da Nav e foi para o avatar
 * (decisao do Fable, PROXIMO.md, etapa D parte 1).
 */
export default async function LayoutPainel({ children }: { children: ReactNode }) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const iniciais = iniciaisDe(sessao.user.name);

  return (
    <div className={styles.pagina}>
      <CabecalhoCelular nomeProduto={config.appName} iniciais={iniciais} rotuloConta={textosNav.conta} />

      <aside className={styles.colunaDesktop}>
        <div className={styles.identidadeDesktop}>
          <Logo tamanho={24} />
          <span className={styles.nomeDesktop}>{config.appName}</span>
        </div>
        <Nav />
        <Link href="/conta" className={styles.contaDesktop}>
          <span className={styles.avatarDesktop}>{iniciais}</span>
          <span>{sessao.user.name}</span>
        </Link>
      </aside>

      <main className={styles.corpo}>{children}</main>

      <div className={styles.barraInferior}>
        <Nav />
      </div>
    </div>
  );
}
