import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { marcasDoUsuario } from "@/servicos/clientes";
import { textosNav } from "@/textos/nav";
import { Nav } from "@/ui/componentes/Nav";
import { Logo } from "@/ui/Logo";

import { BarraLateralToggle } from "./_casca/BarraLateralToggle";
import { CascaCabecalhoCelular } from "./_casca/CascaCabecalhoCelular";
import { SeletorMarcaDesktop } from "./_casca/SeletorMarcaDesktop";
import styles from "./layout.module.css";

/**
 * Casca do cliente (CascaCelular.dc.html, CascaDesktop.dc.html): cabecalho
 * que some ao rolar mais barra inferior no celular; coluna de 220 px com a
 * conta na base no desktop, fixa ao rolar e recolhivel a partir do achado
 * do Gustavo usando o painel no iPad (etapa "acabamento visual 2"). A conta
 * saiu da Nav e foi para o avatar (decisao do Fable, PROXIMO.md, etapa D
 * parte 1); com varias marcas por usuario (V3, item 3), o avatar passa a
 * ser da marca ativa, nao da pessoa, e abre a troca de marca em vez de ir
 * direto para Conta.
 */
export default async function LayoutPainel({ children }: { children: ReactNode }) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const marcas = await marcasDoUsuario(sessao.user.id);
  // Sem marca nenhuma, o layout (completo) redireciona para /comecar ou /entrar;
  // aqui so evita quebrar a casca com uma lista vazia enquanto isso acontece.
  const marcaAtiva = marcas[0] ?? { id: 0, nome: "" };

  return (
    <div className={styles.pagina}>
      <CascaCabecalhoCelular
        nomeProduto={config.appName}
        marcaAtiva={marcaAtiva}
        marcas={marcas}
        nomePessoa={sessao.user.name}
      />

      <aside className={styles.colunaDesktop}>
        <BarraLateralToggle rotuloRecolher={textosNav.recolherMenu} rotuloAbrir={textosNav.abrirMenu} />
        <div className={styles.identidadeDesktop}>
          <Logo tamanho={24} />
          <span className={styles.nomeDesktop}>{config.appName}</span>
        </div>
        <Nav compactavel />
        <SeletorMarcaDesktop marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={sessao.user.name} />
      </aside>

      <main className={styles.corpo}>{children}</main>

      <div className={styles.barraInferior}>
        <Nav />
      </div>
    </div>
  );
}
