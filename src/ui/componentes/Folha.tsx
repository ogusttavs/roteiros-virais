"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { usePuxarParaFechar } from "@/ui/usePuxarParaFechar";

import styles from "./Folha.module.css";

type Props = {
  titulo: string;
  aberto: boolean;
  /**
   * Quem é dono do estado `aberto` chama `useFolhaNoHistorico` e passa aqui o
   * `fechar` dele: assim o véu, o Escape, os botões do rodapé e o arrasto da
   * alça pedem o mesmo caminho, e o botão Voltar do celular também fecha a
   * folha em vez de sair da tela.
   */
  aoFechar: () => void;
  rodape?: ReactNode;
  children: ReactNode;
};

/**
 * A folha que sobe de baixo no celular e centraliza a partir do tablet
 * (design v2, `entrega/telas/Referencias.dc.html`, `.folha-detalhe` e
 * `.folha-filtrar`; V6, itens 3 e 5). Fecha por Escape, pelo clique no véu,
 * pela ação do rodapé e arrastando a alça para baixo (V7, item 1 do
 * PROXIMO.md). O botão Voltar é do dono do estado (ver `aoFechar`).
 *
 * `data-folha-aberta` no véu e na folha liga a trava de rolagem da página de
 * trás no celular (`base.css`).
 */
export function Folha({ titulo, aberto, aoFechar, rodape, children }: Props) {
  const { folhaRef, alca } = usePuxarParaFechar(aoFechar);

  // O ouvinte do Escape lê o `aoFechar` mais recente por uma ref: quem passa uma função nova a cada
  // renderização não faz o efeito rodar de novo, o que devolveria o foco à folha toda vez (mesmo padrão do
  // `useFolhaNoHistorico`).
  const aoFecharRef = useRef(aoFechar);
  useEffect(() => {
    aoFecharRef.current = aoFechar;
  });

  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") aoFecharRef.current();
    }
    document.addEventListener("keydown", aoTeclar);
    folhaRef.current?.focus();
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto, folhaRef]);

  if (!aberto) return null;

  return createPortal(
    <>
      <div className={styles.folhaFundo} data-folha-aberta="" aria-hidden="true" onClick={aoFechar} />
      <div
        ref={folhaRef}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        data-folha-aberta=""
        className={styles.folha}
      >
        <div className={styles.folhaTopo} {...alca}>
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
