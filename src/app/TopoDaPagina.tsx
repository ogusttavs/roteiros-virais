"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import styles from "./page.module.css";

/**
 * O topo da página de vendas quando o cadastro está aberto (E63 PR 2, `PaginaDeVendas-cadastro.dc.html`). No celular, antes de passar da primeira tela, só "Entrar" (o botão grande
 * está logo embaixo e os dois não cabem a 390 px); depois de rolar, só "Começar o teste grátis". Do tablet para cima os dois aparecem sempre (a regra de largura está no CSS).
 */
export function TopoDaPagina({ logotipo, entrar, comecar }: { logotipo: ReactNode; entrar: string; comecar: string }) {
  const [rolado, setRolado] = useState(false);

  useEffect(() => {
    function aoRolar() {
      setRolado(window.scrollY > window.innerHeight * 0.6);
    }
    aoRolar();
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);

  return (
    <header className={styles.topo} data-rolado={rolado ? "sim" : "nao"}>
      {logotipo}
      <div className={styles.acoesDoTopo}>
        <Link href="/entrar" className={`${styles.linkTopo} ${styles.soAntesDeRolar}`}>
          {entrar}
        </Link>
        <Link href="/criar-conta" className={`${styles.botaoTopo} ${styles.soDepoisDeRolar}`}>
          {comecar}
        </Link>
      </div>
    </header>
  );
}
