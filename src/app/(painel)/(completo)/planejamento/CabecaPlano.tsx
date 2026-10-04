"use client";

import { ChevronLeft, ChevronRight, Mic } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { textosHoje } from "@/textos/hoje";
import { textosPlano } from "@/textos/plano";

import styles from "./CabecaPlano.module.css";

export type Visao = "dia" | "semana" | "mes";

type Props = {
  visao: Visao;
  /** O texto pequeno acima do título ("Próximos 7 dias", "Marcado para", "Este mês"...). */
  rotuloPeriodo: string;
  /** O título grande do período ("O que gravar hoje", "7 a 13 de setembro", "Setembro de 2026"...). */
  tituloPeriodo: string;
  /** Acabamento da E39c, parte 2a: a forma curta ("28 set a 4 out"), só na visão Semana, abaixo de 768px. */
  tituloPeriodoCurto?: string;
  /** "Hoje" só aparece fora do período de hoje (dúvida 3 do passo 12). */
  mostrarHoje: boolean;
  hrefAnterior: string;
  hrefSeguinte: string;
  hrefHoje: string;
  hrefPorVisao: Record<Visao, string>;
  aoAbrirContarAgenda: () => void;
};

/**
 * O planejador (passo 12 do Opus, `Hoje.dc.html`, `.cabeca-plano`): o cabeçalho é um só nas três
 * visões, Dia, Semana e Mês. O nome do período com as duas setas ao lado (o que elas andam muda
 * por visão, decidido por quem chama, via `hrefAnterior`/`hrefSeguinte`), o seletor das três
 * visões, "Hoje" fora do período de hoje, e "Contar a minha agenda" (aqui do tablet para cima; no
 * celular cada visão repete o botão no próprio pé, `.so-celular`/`.fora-celular` do design).
 */
export function CabecaPlano({
  visao,
  rotuloPeriodo,
  tituloPeriodo,
  tituloPeriodoCurto,
  mostrarHoje,
  hrefAnterior,
  hrefSeguinte,
  hrefHoje,
  hrefPorVisao,
  aoAbrirContarAgenda,
}: Props) {
  const router = useRouter();
  const [ocupado, iniciarTransicao] = useTransition();

  function ir(destino: string) {
    if (ocupado) return;
    iniciarTransicao(() => router.push(destino));
  }

  const setas = textosHoje.agenda.planejador.setas[visao];

  return (
    <div className={styles.cabecaPlano}>
      <div className={styles.cabecalhoTela}>
        <span className={styles.data}>{rotuloPeriodo}</span>
        <div className={styles.periodo}>
          <h1>
            {tituloPeriodoCurto ? (
              <>
                <span className={styles.tituloCurto}>{tituloPeriodoCurto}</span>
                <span className={styles.tituloLongo}>{tituloPeriodo}</span>
              </>
            ) : (
              tituloPeriodo
            )}
          </h1>
          <button
            type="button"
            className={styles.botaoBarra}
            disabled={ocupado}
            aria-label={setas.anterior}
            onClick={() => ir(hrefAnterior)}
          >
            <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.botaoBarra}
            disabled={ocupado}
            aria-label={setas.seguinte}
            onClick={() => ir(hrefSeguinte)}
          >
            <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={styles.barraPlano}>
        <div className={styles.segmentado} role="tablist" aria-label={textosHoje.agenda.planejador.seletorRotulo}>
          {(["dia", "semana", "mes"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={visao === v}
              disabled={ocupado}
              className={[styles.segmentoBotao, visao === v ? styles.segmentoAtivo : ""].filter(Boolean).join(" ")}
              onClick={() => ir(hrefPorVisao[v])}
            >
              {textosHoje.agenda.planejador.visao[v]}
            </button>
          ))}
        </div>
        {mostrarHoje ? (
          <button type="button" className={styles.botaoSecundarioSm} disabled={ocupado} onClick={() => ir(hrefHoje)}>
            {textosHoje.agenda.planejador.hoje}
          </button>
        ) : null}
        <button
          type="button"
          className={[styles.botaoSecundarioSm, styles.contar, styles.foraCelular].join(" ")}
          onClick={aoAbrirContarAgenda}
        >
          <Mic size={16} strokeWidth={1.75} aria-hidden="true" />
          {textosPlano.botaoContarAgenda}
        </button>
      </div>
    </div>
  );
}
