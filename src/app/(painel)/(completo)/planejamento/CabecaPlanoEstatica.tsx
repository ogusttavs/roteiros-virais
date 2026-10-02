import { ChevronLeft, ChevronRight, Mic } from "lucide-react";

import { textosHoje } from "@/textos/hoje";
import { textosPlano } from "@/textos/plano";

import styles from "./CabecaPlano.module.css";

/**
 * A mesma casca de `CabecaPlano.tsx`, sem interatividade: `loading.tsx` e `error.tsx` (os dois
 * sem dado nenhum ainda, Planejar.dc.html estados `carregando` e `erro`) mostram "Esta semana" e
 * o título da semana atual, com as setas e o seletor desenhados mas inertes (não há `visao` nem
 * `dia` da URL para saber para onde levariam). Vira interativo assim que a visão real carrega.
 */
export function CabecaPlanoEstatica({ tituloPeriodo, tituloPeriodoCurto }: { tituloPeriodo: string; tituloPeriodoCurto: string }) {
  return (
    <div className={styles.cabecaPlano}>
      <div className={styles.cabecalhoTela}>
        <span className={styles.data}>{textosHoje.agenda.estaSemana}</span>
        <div className={styles.periodo}>
          <h1>
            <span className={styles.tituloCurto}>{tituloPeriodoCurto}</span>
            <span className={styles.tituloLongo}>{tituloPeriodo}</span>
          </h1>
          <button type="button" className={styles.botaoBarra} disabled aria-hidden="true" tabIndex={-1}>
            <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" className={styles.botaoBarra} disabled aria-hidden="true" tabIndex={-1}>
            <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={styles.barraPlano}>
        <div className={styles.segmentado} aria-hidden="true">
          {(["dia", "semana", "mes"] as const).map((v) => (
            <span
              key={v}
              className={[styles.segmentoBotao, v === "semana" ? styles.segmentoAtivo : ""].filter(Boolean).join(" ")}
            >
              {textosHoje.agenda.planejador.visao[v]}
            </span>
          ))}
        </div>
        <button
          type="button"
          className={[styles.botaoSecundarioSm, styles.contar, styles.foraCelular].join(" ")}
          disabled
          aria-hidden="true"
          tabIndex={-1}
        >
          <Mic size={16} strokeWidth={1.75} aria-hidden="true" />
          {textosPlano.botaoContarAgenda}
        </button>
      </div>
    </div>
  );
}
