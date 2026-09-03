"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/ui/Logo";

import styles from "./CabecalhoCelular.module.css";

type Props = {
  nomeProduto: string;
  iniciais: string;
  rotuloConta: string;
};

/**
 * Cabecalho fixo do celular: some ao rolar para baixo, volta ao rolar para
 * cima (CascaCelular.dc.html, decisao do Fable no PROXIMO.md). So visivel
 * abaixo de 768px (CabecalhoCelular.module.css).
 */
export function CabecalhoCelular({ nomeProduto, iniciais, rotuloConta }: Props) {
  const [escondido, setEscondido] = useState(false);
  const ultimoRef = useRef(0);

  useEffect(() => {
    function aoRolar() {
      const y = window.scrollY;
      const ultimo = ultimoRef.current;
      const desce = y > ultimo + 4 && y > 60;
      const sobe = y < ultimo - 4 || y < 20;
      if (desce) setEscondido(true);
      else if (sobe) setEscondido(false);
      ultimoRef.current = y;
    }
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);

  return (
    <header className={styles.cabecalho} style={{ transform: escondido ? "translateY(-100%)" : "translateY(0)" }}>
      <div className={styles.identidade}>
        <Logo tamanho={24} />
        <span className={styles.nome}>{nomeProduto}</span>
      </div>
      <Link href="/conta" aria-label={rotuloConta} className={styles.contaBotao}>
        <span className={styles.avatar}>{iniciais}</span>
      </Link>
    </header>
  );
}
