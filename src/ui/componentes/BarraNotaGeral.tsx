"use client";

import { useEffect, useState } from "react";

import styles from "./BarraNotaGeral.module.css";

export type NotaListada = {
  id: string;
  rotulo: string;
  nota: number | null;
  /** Primeira frase de "o que pode melhorar", ja cortada (ajuste de 06/09/2026); ausente sem avaliacao ainda. */
  melhorarResumo?: string | null;
};

type Props = {
  notaAtual: number;
  meta: number;
  rotuloNotaAtual: string;
  /** Ja formatado ("meta 8"). */
  rotuloMeta: string;
  dica?: string;
  notas: NotaListada[];
  /** Texto para uma nota ainda sem avaliacao (ex.: "sem nota"). */
  semNota: string;
  /** aria-label do dialogo no celular (ex.: "As doze notas"). */
  tituloFolha: string;
  /** Tocar numa linha da lista (ajuste de 06/09/2026): rola ate a pergunta. */
  aoTocarItem?: (id: string) => void;
};

function formatarNota(valor: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Barra fina fixa no topo no celular (abre uma folha com a lista completa ao
 * tocar) e cartao fixo no desktop com a lista sempre visivel (entrega/README.md,
 * "abre folha"; CascaCelular/CascaDesktop). A dica ja vem formatada de quem
 * chama; o componente nunca escreve texto de tela.
 */
export function BarraNotaGeral({
  notaAtual,
  meta,
  rotuloNotaAtual,
  rotuloMeta,
  dica,
  notas,
  semNota,
  tituloFolha,
  aoTocarItem,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const atingiu = notaAtual >= meta;

  /**
   * Fecha ao rolar a pagina de tras (brief-frontend.md 6.2, "Ajuste de
   * 06/09/2026"): so ouve o scroll do documento, nunca o scroll interno da
   * propria folha (`.folha` tem overflow-y proprio, que nao borbulha como
   * evento de scroll da window).
   */
  useEffect(() => {
    if (!aberto) return;
    function fechar() {
      setAberto(false);
    }
    window.addEventListener("scroll", fechar, { passive: true });
    return () => window.removeEventListener("scroll", fechar);
  }, [aberto]);

  function tocarItem(id: string) {
    setAberto(false);
    aoTocarItem?.(id);
  }

  const lista = (
    <ul className={styles.lista}>
      {notas.map((item) => (
        <li key={item.id} className={styles.itemLista}>
          <button type="button" className={styles.botaoItem} onClick={() => tocarItem(item.id)}>
            <span className={styles.linhaPrincipal}>
              <span className={styles.rotuloItem}>{item.rotulo}</span>
              <span className={styles.notaItem}>{item.nota === null ? semNota : formatarNota(item.nota)}</span>
            </span>
            {item.melhorarResumo ? <span className={styles.melhorarResumo}>{item.melhorarResumo}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <button
        type="button"
        className={styles.barraCelular}
        onClick={() => setAberto(true)}
        aria-haspopup="dialog"
        aria-label={tituloFolha}
      >
        <span className={styles.resumo}>
          <span>
            {rotuloNotaAtual} <strong className={styles.numeroResumo}>{formatarNota(notaAtual)}</strong>
          </span>
          <span className={styles.metaResumo}>{rotuloMeta}</span>
        </span>
        {dica ? <span className={styles.dicaResumo}>{dica}</span> : null}
      </button>

      {aberto ? (
        <div className={styles.veu} onClick={() => setAberto(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={tituloFolha}
            className={styles.folha}
            onClick={(evento) => evento.stopPropagation()}
          >
            <div className={styles.cabecalhoFolha}>
              <span className={[styles.numeroFolha, atingiu ? styles.atingiu : ""].filter(Boolean).join(" ")}>
                {formatarNota(notaAtual)}
              </span>
              <span className={styles.metaResumo}>{rotuloMeta}</span>
            </div>
            {lista}
          </div>
        </div>
      ) : null}

      <aside className={styles.cartaoDesktop}>
        <span className={styles.rotuloCartao}>{rotuloNotaAtual}</span>
        <div className={styles.cabecalhoFolha}>
          <span className={[styles.numeroFolha, atingiu ? styles.atingiu : ""].filter(Boolean).join(" ")}>
            {formatarNota(notaAtual)}
          </span>
          <span className={styles.metaResumo}>{rotuloMeta}</span>
        </div>
        {dica ? <p className={styles.dicaCartao}>{dica}</p> : null}
        {lista}
      </aside>
    </>
  );
}
