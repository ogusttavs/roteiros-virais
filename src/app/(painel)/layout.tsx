import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { config } from "@/lib/config";
import { iniciaisDe } from "@/lib/iniciais";
import { sessaoAtual } from "@/lib/sessao";
import { textosNav } from "@/textos/nav";
import { Nav } from "@/ui/componentes/Nav";
import { Logo } from "@/ui/Logo";

import { BarraLateralToggle } from "./_casca/BarraLateralToggle";
import { CabecalhoCelular } from "./_casca/CabecalhoCelular";
import styles from "./layout.module.css";

/**
 * Casca do cliente (CascaCelular.dc.html, CascaDesktop.dc.html): cabecalho
 * que some ao rolar mais barra inferior no celular; coluna de 220 px com a
 * conta na base no desktop, fixa ao rolar e recolhivel a partir do achado
 * do Gustavo usando o painel no iPad (etapa "acabamento visual 2"). A conta
 * saiu da Nav e foi para o avatar (decisao do Fable, PROXIMO.md, etapa D
 * parte 1).
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
        <BarraLateralToggle rotuloRecolher={textosNav.recolherMenu} rotuloAbrir={textosNav.abrirMenu} />
        <div className={styles.identidadeDesktop}>
          <Logo tamanho={24} />
          <span className={styles.nomeDesktop}>{config.appName}</span>
        </div>
        <Nav compactavel />
        <Link href="/conta" className={styles.contaDesktop} title={sessao.user.name}>
          <span className={styles.avatarDesktop}>{iniciais}</span>
          <span className={styles.nomeConta}>{sessao.user.name}</span>
        </Link>
      </aside>

      <main className={styles.corpo}>{children}</main>

      <div className={styles.barraInferior}>
        <Nav />
      </div>
    </div>
  );
}
