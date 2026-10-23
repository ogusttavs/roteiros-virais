"use client";

import { Bookmark, Play } from "lucide-react";
import { useState } from "react";

import type { FaixaMultiplo } from "@/lib/formatarNumero";
import { formatarViewsExato } from "@/lib/formatarNumero";
import { textosConexao } from "@/textos/conexao";
import { textosReferencias } from "@/textos/referencias";
import { ID_FAIXA_SEM_CONEXAO } from "@/ui/ConexaoContext";

import { Botao } from "./Botao";
import { CapaImagem } from "./CapaImagem";
import styles from "./ReferenciaCartao.module.css";
import stylesLongo from "./ReferenciaLongoCartao.module.css";

/** O vídeo longo de referência já em frases, para o cartão (`ReferenciasTela` formata; o cartão só desenha). */
export type LongoFormatado = {
  id: number;
  multiplo: string;
  rotuloMultiplo: string;
  faixaMultiplo: FaixaMultiplo;
  views: number;
  medianaConta: number | null;
  contaNome: string;
  /** "YouTube, 28 de agosto" */
  plataformaData: string;
  titulo: string | null;
  capaUrl: string | null;
  /** "11:02" */
  duracaoTexto: string;
  /** Os capítulos que o dono escreveu na descrição (até cinco), com o tempo já escrito. */
  capitulos: { tempo: string; titulo: string }[];
  maisCapitulos: number;
  /** Só quando a leitura da estrutura existe e a abertura entrega; nulo nos outros ("Ver desde o começo"). */
  capituloQueInteressa: { inicioS: number; de: string; ate: string; nome: string; promessa: string; esquerdaPct: number; larguraPct: number } | null;
  ramoNome?: string;
};

type Props = {
  video: LongoFormatado;
  salvo: boolean;
  salvando?: boolean;
  semRede?: boolean;
  /** Abre a prévia no segundo dado (o começo do capítulo que interessa, ou 0). */
  onVer: (segundoS: number) => void;
  onSalvar: () => void;
};

/**
 * O cartão do vídeo longo nas Referências (E52, PR 4c, `Referencias.dc.html`, estado `longos`): a capa deitada (16:9) com a duração no canto, os números de sempre, os capítulos que o dono
 * escreveu na descrição e, só com o que o banco tem, "o capítulo que interessa" com a marca no trilho. Sem leitura da estrutura, o botão é "Ver desde o começo": nunca se inventa o capítulo.
 */
export function ReferenciaLongoCartao({ video, salvo, salvando = false, semRede = false, onVer, onSalvar }: Props) {
  const [capaComErro, setCapaComErro] = useState(false);
  const mostrarCapa = video.capaUrl !== null && !capaComErro;
  const capitulo = video.capituloQueInteressa;
  const t = textosReferencias.duracao;

  return (
    <article className={[styles.cartao, stylesLongo.longo].join(" ")} data-cartao-longo>
      <div className={styles.videoTopo}>
        <span className={stylesLongo.capaLonga} aria-hidden="true">
          {mostrarCapa && video.capaUrl ? (
            <CapaImagem src={video.capaUrl} className={styles.capaImagem} aoFalhar={() => setCapaComErro(true)} />
          ) : (
            <Play size={24} strokeWidth={1.5} aria-hidden="true" />
          )}
          <span className={stylesLongo.duracaoNaCapa}>{video.duracaoTexto}</span>
        </span>
        <div className={styles.multiplo}>
          <span className={[styles.valor, video.faixaMultiplo !== "acima" ? styles.valorNeutro : ""].filter(Boolean).join(" ")}>{video.multiplo}</span>
          <span className={styles.frase}>{video.rotuloMultiplo}</span>
        </div>
      </div>

      <div className={styles.numeros}>
        <span>{textosReferencias.viewsRotulo(formatarViewsExato(video.views))}</span>
        {video.medianaConta !== null ? <span>{textosReferencias.normalDessaConta(formatarViewsExato(video.medianaConta))}</span> : null}
      </div>

      <div className={styles.videoConta}>
        <span className={styles.nome}>{video.contaNome}</span>
        <span className={styles.quando}>{video.plataformaData}</span>
      </div>

      <div className={styles.selos}>
        <span className={[styles.selo, styles.seloTipo].join(" ")} data-selo-video-longo>
          {t.seloVideoLongo}
        </span>
        {video.ramoNome ? (
          <span className={styles.selo} data-selo-ramo>
            {video.ramoNome}
          </span>
        ) : null}
      </div>

      {video.titulo ? <p className={styles.tituloVideo}>{video.titulo}</p> : null}

      {video.capitulos.length > 0 ? (
        <div className={stylesLongo.capitulos} data-capitulos-da-descricao>
          <span className={stylesLongo.rotuloCapitulos}>{t.capitulosDaDescricao}</span>
          <ol>
            {video.capitulos.map((c) => (
              <li key={`${c.tempo}-${c.titulo}`}>
                <b>{c.tempo}</b>
                <span>{c.titulo}</span>
              </li>
            ))}
          </ol>
          {video.maisCapitulos > 0 ? <span className={stylesLongo.maisCapitulos}>{t.maisCapitulos(video.maisCapitulos)}</span> : null}
        </div>
      ) : null}

      {capitulo ? (
        <div className={stylesLongo.capituloQueInteressa} data-capitulo-que-interessa>
          <span>
            {t.capituloQueInteressa}{" "}
            <b>
              {capitulo.de} a {capitulo.ate}
            </b>
            , {capitulo.nome}
          </span>
          {capitulo.promessa ? <span className={stylesLongo.promessa}>{t.promete(capitulo.promessa)}</span> : null}
          <span className={stylesLongo.trilho} role="img" aria-label={t.trilhoAria(capitulo.de, capitulo.ate, video.duracaoTexto)}>
            <i style={{ left: `${capitulo.esquerdaPct}%`, width: `${capitulo.larguraPct}%` }} />
          </span>
        </div>
      ) : null}

      <div className={styles.acoes}>
        <Botao
          variante="secundario"
          tamanho="md"
          className={styles.acaoVerDetalhes}
          aria-label={capitulo ? t.verOCapituloAria(video.contaNome) : t.verDesdeOComecoAria(video.contaNome)}
          onClick={() => onVer(capitulo ? capitulo.inicioS : 0)}
        >
          {capitulo ? t.verOCapitulo : t.verDesdeOComeco}
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
