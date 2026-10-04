"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { textosComuns } from "@/textos/comuns";
import { useFolhaAnimada } from "@/ui/useFolhaAnimada";
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
  /**
   * R2b, revisão do Fable no PR #100: a folha "Por que esse funcionou" precisa de mais largura a
   * partir de 1024px (o vídeo à esquerda, o texto à direita, sem rolar para ver a conta e os
   * números). Opcional porque as outras folhas (Filtrar, por exemplo) continuam na largura padrão.
   */
  largo?: boolean;
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
 *
 * O X (E39c, parte 1, pedido do Gustavo: "abri a parte de planejar os
 * próximos dias e não tem um X para fechar") fica fora de `.folhaTopo`, que
 * tem o arrasto (`usePuxarParaFechar`) espalhado por ela; um botão lá dentro
 * ganharia a captura do ponteiro do arrasto em vez de um clique normal.
 */
export function Folha({ titulo, aberto, aoFechar, rodape, largo = false, children }: Props) {
  const { folhaRef, alca } = usePuxarParaFechar(aoFechar);
  const { montada, saindo } = useFolhaAnimada(aberto);
  const tituloRef = useRef<HTMLHeadingElement>(null);

  // O ouvinte do Escape lê o `aoFechar` mais recente por uma ref: quem passa uma função nova a cada
  // renderização não faz o efeito rodar de novo, o que devolveria o foco à folha toda vez (mesmo padrão do
  // `useFolhaNoHistorico`).
  const aoFecharRef = useRef(aoFechar);
  useEffect(() => {
    aoFecharRef.current = aoFechar;
  });

  useEffect(() => {
    if (!aberto) return;
    // Passo 16, capítulo 4: o foco vai ao título ao abrir, fica preso na folha e volta ao botão que abriu. Celular nunca abre o teclado sozinho (o título não é um campo).
    const quemAbriu = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        aoFecharRef.current();
        return;
      }
      if (evento.key !== "Tab" || !folhaRef.current) return;
      const alvos = Array.from(
        folhaRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      ).filter((alvo) => alvo.offsetParent !== null || alvo === document.activeElement);
      if (alvos.length === 0) return;
      const primeiro = alvos[0];
      const ultimo = alvos[alvos.length - 1];
      const atual = document.activeElement;
      if (evento.shiftKey && (atual === primeiro || atual === folhaRef.current || atual === tituloRef.current)) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && atual === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      } else if (!folhaRef.current.contains(atual)) {
        evento.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    (tituloRef.current ?? folhaRef.current)?.focus();
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      if (quemAbriu?.isConnected) quemAbriu.focus({ preventScroll: true });
    };
  }, [aberto, folhaRef]);

  if (!montada) return null;

  return createPortal(
    <>
      <div className={[styles.folhaFundo, saindo ? styles.saindo : ""].filter(Boolean).join(" ")} data-folha-aberta="" data-veu="" aria-hidden="true" onClick={aoFechar} />
      <div
        ref={folhaRef}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        data-folha-aberta=""
        data-saindo={saindo ? "" : undefined}
        className={[styles.folha, largo ? styles.folhaLarga : "", saindo ? styles.saindo : ""].filter(Boolean).join(" ")}
      >
        <button type="button" className={styles.folhaFechar} onClick={aoFechar} aria-label={textosComuns.fechar}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
        <div className={styles.folhaTopo} {...alca}>
          <span className={styles.folhaAlca} aria-hidden="true" />
          <h3 ref={tituloRef} tabIndex={-1} className={styles.folhaTitulo}>
            {titulo}
          </h3>
        </div>
        <div className={styles.folhaCorpo}>{children}</div>
        {rodape ? <div className={styles.folhaPe}>{rodape}</div> : null}
      </div>
    </>,
    document.body,
  );
}
