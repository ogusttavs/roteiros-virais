"use client";

import { useEffect, useRef, useState } from "react";

import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import styles from "./BarraNotaGeral.module.css";
import { faixaMeta } from "./notaFaixaMeta";

const CLASSE_FAIXA_ITEM = { naMeta: styles.itemNaMeta, neutra: "", baixa: styles.itemBaixa };

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
 *
 * A folha fecha por veu, Esc, rolagem da pagina de tras e pelo Voltar do
 * aparelho (`useFolhaNoHistorico`; V7, item 1 do PROXIMO.md), leva o foco ao
 * abrir e o devolve ao botao da barra ao fechar.
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
  const { fechar, fecharEDepois } = useFolhaNoHistorico(aberto, () => setAberto(false));
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const folhaRef = useRef<HTMLDivElement>(null);
  const atingiu = notaAtual >= meta;

  /**
   * Fecha ao rolar a pagina de tras (brief-frontend.md 6.2, "Ajuste de
   * 06/09/2026"): so ouve o scroll do documento, nunca o scroll interno da
   * propria folha (`.folha` tem overflow-y proprio, que nao borbulha como
   * evento de scroll da window). O ouvinte se remove no primeiro disparo: a
   * rolagem dispara o evento varias vezes antes de o Voltar do historico
   * chegar, e cada `fechar` desfaz uma entrada, entao a segunda chamada
   * tiraria a pessoa da tela.
   *
   * Esc fecha, a folha recebe o foco ao abrir e o botao da barra o recebe de
   * volta ao fechar (V7, item 1 do PROXIMO.md). `preventScroll` nos dois:
   * mover o foco nunca pode rolar a pagina (a rolagem fecharia a folha).
   */
  useEffect(() => {
    if (!aberto) return;
    const gatilho = gatilhoRef.current;
    function fecharAoRolar() {
      window.removeEventListener("scroll", fecharAoRolar);
      fechar();
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") fechar();
    }
    window.addEventListener("scroll", fecharAoRolar, { passive: true });
    document.addEventListener("keydown", aoTeclar);
    folhaRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("scroll", fecharAoRolar);
      document.removeEventListener("keydown", aoTeclar);
      gatilho?.focus({ preventScroll: true });
    };
  }, [aberto, fechar]);

  function tocarItem(id: string) {
    // O historico devolve a posicao de rolagem que a pagina tinha quando a folha abriu; rolar ate a pergunta no
    // mesmo instante do fechamento seria desfeito. O `setTimeout` deixa a rolagem para depois do Voltar.
    fecharEDepois(() => {
      setTimeout(() => aoTocarItem?.(id), 0);
    });
  }

  const lista = (
    <ul className={styles.lista}>
      {notas.map((item) => (
        <li key={item.id} className={styles.itemLista}>
          <button type="button" className={styles.botaoItem} onClick={() => tocarItem(item.id)}>
            <span className={styles.linhaPrincipal}>
              <span className={styles.rotuloItem}>{item.rotulo}</span>
              <span
                className={[styles.notaItem, item.nota === null ? "" : CLASSE_FAIXA_ITEM[faixaMeta(item.nota, meta)]]
                  .filter(Boolean)
                  .join(" ")}
              >
                {item.nota === null ? semNota : formatarNota(item.nota)}
              </span>
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
        ref={gatilhoRef}
        type="button"
        className={styles.barraCelular}
        onClick={() => setAberto(true)}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-label={tituloFolha}
      >
        <span className={styles.resumo}>
          <span>
            {rotuloNotaAtual}{" "}
            <strong className={[styles.numeroResumo, atingiu ? styles.atingiu : ""].filter(Boolean).join(" ")}>
              {formatarNota(notaAtual)}
            </strong>
          </span>
          <span className={styles.metaResumo}>{rotuloMeta}</span>
        </span>
        {dica ? <span className={styles.dicaResumo}>{dica}</span> : null}
      </button>

      {aberto ? (
        <div className={styles.veu} data-folha-aberta="" onClick={fechar}>
          <div
            ref={folhaRef}
            role="dialog"
            aria-modal="true"
            aria-label={tituloFolha}
            tabIndex={-1}
            data-folha-aberta=""
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
