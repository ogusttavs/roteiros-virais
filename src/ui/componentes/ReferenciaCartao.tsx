"use client";

import { Bookmark, Play } from "lucide-react";

import type { FaixaMultiplo } from "@/lib/formatarNumero";
import { formatarViewsExato } from "@/lib/formatarNumero";
import { textosConexao } from "@/textos/conexao";
import { textosReferencias } from "@/textos/referencias";
import { ID_FAIXA_SEM_CONEXAO } from "@/ui/ConexaoContext";

import { Botao } from "./Botao";
import styles from "./ReferenciaCartao.module.css";

/** Computado uma vez a partir do `VideoReferencia` bruto (`ReferenciasTela`), reaproveitado pelo cartão e pela folha de detalhes. */
export type VideoFormatado = {
  id: number;
  url: string;
  multiplo: string;
  rotuloMultiplo: string;
  faixaMultiplo: FaixaMultiplo;
  views: number;
  medianaConta: number | null;
  velocidade: number | null;
  contaNome: string;
  /** "Instagram, 5 de setembro" */
  plataformaData: string;
  titulo: string | null;
  assunto: string;
  gancho: string;
  estrutura: string;
  porQueFuncionou: string;
};

type Props = {
  video: VideoFormatado;
  salvo: boolean;
  /** Enquanto a Server Action de favoritar não responde (achado da revisão da parte 1). */
  salvando?: boolean;
  /**
   * Sem conexão (V7, item 8 do PROXIMO.md): favoritar chama o servidor, então o botão fica desabilitado. É um
   * ícone sozinho, sem espaço para uma linha de motivo em cada cartão: o motivo é a faixa "Sem conexão" do topo
   * (`aria-describedby`) e o `title`. O nome acessível continua "salvar", nunca "salvando" sem estar salvando.
   */
  semRede?: boolean;
  onVerDetalhes: () => void;
  onSalvar: () => void;
};

function linhaVelocidade(velocidade: number | null): string {
  if (velocidade === null) return textosReferencias.passouDas72Horas;
  return textosReferencias.viewsPorHora(formatarViewsExato(velocidade));
}

/**
 * Um vídeo da biblioteca de referências (V6, item 4, `Referencias.dc.html`,
 * `.video-topo`/`.video-conta`/`.titulo-video`/`.acoes-video`):
 * a capa neutra (sem coletor de miniatura nesta rodada), o múltiplo com a
 * palavra ao lado, os três números que fizeram o vídeo ser fora da curva,
 * o canal e a data, o título em uma linha, e as duas ações. A análise
 * inteira mora na folha de detalhes, não aqui.
 */
export function ReferenciaCartao({ video, salvo, salvando = false, semRede = false, onVerDetalhes, onSalvar }: Props) {
  return (
    <article className={styles.cartao}>
      <div className={styles.videoTopo}>
        <span className={styles.capa} aria-hidden="true">
          <Play size={24} strokeWidth={1.5} aria-hidden="true" />
        </span>
        <div className={styles.multiplo}>
          <span
            className={[styles.valor, video.faixaMultiplo !== "acima" ? styles.valorNeutro : ""]
              .filter(Boolean)
              .join(" ")}
          >
            {video.multiplo}
          </span>
          <span className={styles.frase}>{video.rotuloMultiplo}</span>
        </div>
      </div>

      <div className={styles.numeros}>
        <span>{textosReferencias.viewsRotulo(formatarViewsExato(video.views))}</span>
        {video.medianaConta !== null ? (
          <span>{textosReferencias.normalDessaConta(formatarViewsExato(video.medianaConta))}</span>
        ) : null}
        <span>{linhaVelocidade(video.velocidade)}</span>
      </div>

      <div className={styles.videoConta}>
        <span className={styles.nome}>{video.contaNome}</span>
        <span className={styles.quando}>{video.plataformaData}</span>
      </div>

      {video.titulo ? <p className={styles.tituloVideo}>{video.titulo}</p> : null}

      <div className={styles.acoes}>
        <Botao variante="secundario" tamanho="md" className={styles.acaoVerDetalhes} onClick={onVerDetalhes}>
          {textosReferencias.verDetalhes}
        </Botao>
        <button
          type="button"
          aria-pressed={salvo}
          aria-label={salvando ? textosReferencias.salvando : salvo ? textosReferencias.salvo : textosReferencias.salvar}
          aria-describedby={semRede ? ID_FAIXA_SEM_CONEXAO : undefined}
          title={semRede ? textosConexao.precisaDeConexao : undefined}
          disabled={salvando || semRede}
          onClick={onSalvar}
          className={styles.salvar}
        >
          <Bookmark size={20} strokeWidth={1.5} fill={salvo ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
