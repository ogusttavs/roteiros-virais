"use client";

import { Bookmark, ExternalLink } from "lucide-react";

import { formatarViewsExato } from "@/lib/formatarNumero";
import { textosReferencias } from "@/textos/referencias";
import { Botao } from "@/ui/componentes/Botao";
import { Folha } from "@/ui/componentes/Folha";
import type { VideoFormatado } from "@/ui/componentes/ReferenciaCartao";
import { VideoEmbed } from "@/ui/componentes/VideoEmbed";

import styles from "./FolhaDetalhesVideo.module.css";

type Props = {
  video: VideoFormatado | null;
  url: string | null;
  aberto: boolean;
  aoFechar: () => void;
  salvo: boolean;
  salvando?: boolean;
  onUsarComoReferencia: () => void;
  onSalvar: () => void;
};

function linhaVelocidade(velocidade: number | null): string {
  if (velocidade === null) return textosReferencias.passouDas72Horas;
  return textosReferencias.viewsPorHora(formatarViewsExato(velocidade));
}

/**
 * "Por que esse funcionou" (V6, item 5, `Referencias.dc.html`,
 * `.folha-detalhe`): o vídeo embedado, os números, e as três partes da
 * análise sem teto de linhas (o cartão mostra só o número). O bloco "Como
 * isso vira vídeo seu" e "O que o público comentou" do design não têm
 * campo na `AnaliseVideo` de hoje: não entram nesta parte (E28, ver
 * Decisões pendentes).
 */
export function FolhaDetalhesVideo({ video, url, aberto, aoFechar, salvo, salvando = false, onUsarComoReferencia, onSalvar }: Props) {
  if (!video || !url) return null;

  return (
    <Folha
      titulo={textosReferencias.folhaDetalhesTitulo}
      aberto={aberto}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao variante="primario" tamanho="lg" onClick={onUsarComoReferencia}>
            {textosReferencias.usarComoReferencia}
          </Botao>
          <div className={styles.linhaPe}>
            <a href={url} target="_blank" rel="noopener noreferrer" className={styles.abrirNaPlataforma}>
              <ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" />
              {textosReferencias.abrirNaPlataforma}
            </a>
            <button
              type="button"
              aria-pressed={salvo}
              aria-label={salvando ? textosReferencias.salvando : salvo ? textosReferencias.salvo : textosReferencias.salvar}
              disabled={salvando}
              onClick={onSalvar}
              className={styles.botaoSalvar}
            >
              <Bookmark size={20} strokeWidth={1.5} fill={salvo ? "currentColor" : "none"} aria-hidden="true" />
            </button>
          </div>
        </>
      }
    >
      <VideoEmbed
        url={url}
        alt={textosReferencias.embedAlt(video.contaNome)}
        rotuloCarregamento={textosReferencias.embedCarregando}
        linkExterno={{ rotulo: textosReferencias.abrirNaPlataforma, href: url }}
      />

      <div className={styles.videoConta}>
        <span className={styles.nome}>{video.contaNome}</span>
        <span className={styles.quando}>{video.plataformaData}</span>
      </div>
      {video.titulo ? <p className={styles.tituloVideo}>{video.titulo}</p> : null}

      <div className={styles.numeros}>
        <span>
          <b>{video.multiplo}</b> {video.rotuloMultiplo}
        </span>
        <span>
          {video.medianaConta !== null
            ? textosReferencias.viewsContraNormal(formatarViewsExato(video.views), formatarViewsExato(video.medianaConta))
            : textosReferencias.viewsRotulo(formatarViewsExato(video.views))}
        </span>
        <span>{linhaVelocidade(video.velocidade)}</span>
      </div>

      <div className={styles.analise}>
        <div>
          <strong>{textosReferencias.analise.comecou}</strong>
          <p>{video.gancho}</p>
        </div>
        <div>
          <strong>{textosReferencias.analise.construiu}</strong>
          <p>{video.estrutura}</p>
        </div>
        <div>
          <strong>{textosReferencias.analise.funcionou}</strong>
          <p>{video.porQueFuncionou}</p>
        </div>
      </div>
    </Folha>
  );
}
