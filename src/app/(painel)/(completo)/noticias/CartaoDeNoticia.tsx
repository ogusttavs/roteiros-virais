"use client";

import { Check, ExternalLink } from "lucide-react";
import Link from "next/link";

import { textosNoticias } from "@/textos/noticias";
import { Botao } from "@/ui/componentes/Botao";

import styles from "./NoticiasTela.module.css";

/** Uma notícia da capa, pronta do servidor (as datas já viraram texto; os endereços já foram revalidados: só https, ou nulos). */
export type NoticiaNaTela = {
  chave: string;
  tipo: "setor" | "assunto";
  noticiaId: number;
  assuntoId: number | null;
  origemRotulo: string;
  titulo: string;
  veiculo: string;
  /** "07:40" no fuso de São Paulo, ou "ontem" / "anteontem" nas que não são de hoje. */
  quando: string;
  resumo: string | null;
  url: string | null;
  imagemUrl: string | null;
  imagemCredito: string | null;
  roteiroId: number | null;
};

type Props = {
  noticia: NoticiaNaTela;
  destaque?: boolean;
  /** A pessoa abriu o original ou pediu o roteiro: o assunto fica vivo (o chamador ignora a recusa do "ver como"). */
  aoAbrir: (noticia: NoticiaNaTela) => void;
  aoCriarRoteiro: (noticia: NoticiaNaTela) => void;
};

function Foto({ noticia }: { noticia: NoticiaNaTela }) {
  if (noticia.imagemUrl) {
    return (
      <figure className={styles.foto}>
        {/* A foto é do veículo e vem de fora: sem `referer` e sem pular a tela. O crédito é sempre o do veículo. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={noticia.imagemUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        <figcaption>{noticia.imagemCredito ?? textosNoticias.foto(noticia.veiculo)}</figcaption>
      </figure>
    );
  }
  return (
    <div className={styles.semFoto} aria-hidden="true">
      <span className={styles.veiculoGrande}>{noticia.veiculo || textosNoticias.veiculoDesconhecido}</span>
      <span className={styles.aspas}>&ldquo;</span>
    </div>
  );
}

/**
 * Um cartão da capa (E53): a foto do veículo com o crédito (ou o bloco de tipografia, sem foto), a etiqueta de onde veio, o veículo e a hora, o título que abre o original numa aba, o nosso
 * resumo de duas linhas e "Criar roteiro com esta notícia". O texto da matéria nunca aparece aqui.
 */
export function CartaoDeNoticia({ noticia, destaque = false, aoAbrir, aoCriarRoteiro }: Props) {
  const titulo = noticia.url ? (
    <a href={noticia.url} target="_blank" rel="noopener noreferrer" className={styles.linkOriginal} onClick={() => aoAbrir(noticia)}>
      {noticia.titulo}
      {destaque ? (
        <span className={styles.externo} aria-hidden="true">
          <ExternalLink strokeWidth={1.5} />
        </span>
      ) : null}
    </a>
  ) : (
    noticia.titulo
  );

  const texto = (
    <>
      <span className={styles.fonte}>
        <span className={[styles.origem, noticia.tipo === "assunto" ? styles.origemAssunto : styles.origemSetor].join(" ")}>{noticia.origemRotulo}</span>
        <span className={styles.veiculo}>{noticia.veiculo || textosNoticias.veiculoDesconhecido}</span>
        <span className={styles.hora}>{noticia.quando}</span>
      </span>
      {destaque ? <h2>{titulo}</h2> : <h3>{titulo}</h3>}
      {noticia.resumo ? <p className={styles.resumo}>{noticia.resumo}</p> : null}
      <div className={styles.acoes}>
        {noticia.roteiroId ? (
          <>
            <span className={styles.virouRoteiro}>
              <Check size={14} strokeWidth={2} aria-hidden="true" />
              {textosNoticias.virouRoteiro}
            </span>
            <Link href={`/roteiros/${noticia.roteiroId}`} className={styles.verRoteiro}>
              {textosNoticias.verORoteiro}
            </Link>
          </>
        ) : (
          <Botao variante={destaque ? "primario" : "ghost"} tamanho="md" className={destaque ? undefined : styles.botaoTexto} onClick={() => aoCriarRoteiro(noticia)}>
            {textosNoticias.criarRoteiro}
          </Botao>
        )}
      </div>
    </>
  );

  if (destaque) {
    return (
      <article className={styles.destaque} data-noticia={noticia.chave}>
        <Foto noticia={noticia} />
        <div className={styles.textoDestaque}>{texto}</div>
      </article>
    );
  }
  return (
    <article className={styles.noticia} data-noticia={noticia.chave}>
      <Foto noticia={noticia} />
      <div className={styles.textoCartao}>{texto}</div>
    </article>
  );
}
