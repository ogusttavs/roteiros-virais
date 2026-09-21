"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import styles from "./Folha.module.css";

type Props = {
  titulo: string;
  aberto: boolean;
  aoFechar: () => void;
  rodape?: ReactNode;
  children: ReactNode;
};

/**
 * A folha que sobe de baixo no celular e centraliza a partir do tablet
 * (design v2, `entrega/telas/Referencias.dc.html`, `.folha-detalhe` e
 * `.folha-filtrar`; V6, itens 3 e 5). Fecha por Escape, pelo clique no véu
 * e pela ação do rodapé; sem gesto de voltar pelo histórico do navegador
 * (a folha de reprovar do Roteiro, a única outra folha modal do painel,
 * também não usa).
 */
export function Folha({ titulo, aberto, aoFechar, rodape, children }: Props) {
  const folhaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    folhaRef.current?.focus();
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return createPortal(
    <>
      <div className={styles.folhaFundo} aria-hidden="true" onClick={aoFechar} />
      <div ref={folhaRef} role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1} className={styles.folha}>
        <div className={styles.folhaTopo}>
          <span className={styles.folhaAlca} aria-hidden="true" />
          <h3 className={styles.folhaTitulo}>{titulo}</h3>
        </div>
        <div className={styles.folhaCorpo}>{children}</div>
        {rodape ? <div className={styles.folhaPe}>{rodape}</div> : null}
      </div>
    </>,
    document.body,
  );
}
