"use client";

import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { textosNav } from "@/textos/nav";
import { Logo } from "@/ui/Logo";

import styles from "./CabecalhoCelular.module.css";
import { SeletorMarcaCelular, type MarcaResumo } from "./SeletorMarcaCelular";

type Props = {
  nomeProduto: string;
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
};

/**
 * Cabecalho fixo do celular: some ao rolar para baixo, volta ao rolar para
 * cima (CascaCelular.dc.html, decisao do Fable no PROXIMO.md). So visivel
 * abaixo de 768px (CabecalhoCelular.module.css). A pilula de marca e o
 * botao "Atualizar" (V3, item 3, Casca.dc.html) ficam do lado direito,
 * depois da identidade do produto.
 */
export function CabecalhoCelular({ nomeProduto, marcaAtiva, marcas, nomePessoa }: Props) {
  const [escondido, setEscondido] = useState(false);
  const ultimoRef = useRef(0);
  const router = useRouter();

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
    <header
      className={marcas.length > 1 ? `${styles.cabecalho} ${styles.comMarca}` : styles.cabecalho}
      style={{ transform: escondido ? "translateY(-100%)" : "translateY(0)" }}
    >
      <div className={styles.identidade}>
        <Logo tamanho={24} />
        <span className={styles.nome}>{nomeProduto}</span>
      </div>
      <div className={styles.direita}>
        <SeletorMarcaCelular marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
        <button
          type="button"
          className={styles.botaoBarra}
          aria-label={textosNav.atualizar}
          onClick={() => router.refresh()}
        >
          <RotateCw size={18} aria-hidden="true" />
          <span className={styles.cede}>{textosNav.atualizar}</span>
        </button>
      </div>
    </header>
  );
}
