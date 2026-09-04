"use client";

import { ExternalLink, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import styles from "./VideoEmbed.module.css";

export type VideoEmbedProps = {
  url: string;
  alt: string;
  /** Ja formatado ("vídeo embedado 9:16 · carrega ao entrar na tela"). */
  rotuloCarregamento: string;
  /** Quando o ator/API nao devolve embed oficial para a plataforma (TikTok e Instagram hoje). */
  falhou?: boolean;
  linkExterno: { rotulo: string; href: string };
  /** O embed já carrega começando neste segundo (RoteiroTela, "olha como ele faz aos X"). */
  segundoInicial?: number;
};

type Props = VideoEmbedProps;

function idDoYoutube(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1) || null;
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
    return null;
  } catch {
    return null;
  }
}

/** `/p/<codigo>` ou `/reel/<codigo>` viram `/p/<codigo>/embed` (embed oficial, sem SDK). */
function urlEmbedInstagram(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("instagram.com")) return null;
    const caminho = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
    return `https://www.instagram.com${caminho}embed`;
  } catch {
    return null;
  }
}

function eUrlDoTiktok(url: string): boolean {
  try {
    return new URL(url).hostname.includes("tiktok.com");
  } catch {
    return false;
  }
}

/**
 * Embed oficial 9:16, carregamento tardio ao entrar na tela (RoteiroTela,
 * ReferenciasTela). YouTube e Instagram viram iframe só por transformação de
 * URL; o TikTok não expõe o id do vídeo de forma confiável em toda URL
 * (link curto de compartilhamento não traz o número), então o carregamento
 * tardio dispara uma chamada ao oEmbed oficial do TikTok
 * (`https://www.tiktok.com/oembed?url=`) só para extrair o id do vídeo, sem
 * injetar o HTML nem o script que a resposta traz: o iframe final
 * (`/embed/v2/<id>`) é montado à mão, mesma regra das outras duas
 * plataformas, sem SDK de terceiro no bundle.
 */
export function VideoEmbed({
  url,
  alt,
  rotuloCarregamento,
  falhou = false,
  linkExterno,
  segundoInicial,
}: Props) {
  const [visivel, setVisivel] = useState(false);
  const [idTiktok, setIdTiktok] = useState<string | null>(null);
  const [falhouTiktok, setFalhouTiktok] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const idYoutube = idDoYoutube(url);
  const urlInstagram = urlEmbedInstagram(url);
  const eTiktok = eUrlDoTiktok(url);
  const embedavel = Boolean(idYoutube) || Boolean(urlInstagram) || eTiktok;

  useEffect(() => {
    if (!ref.current || falhou || !embedavel) return;
    const observer = new IntersectionObserver(
      ([entrada]) => {
        if (entrada.isIntersecting) setVisivel(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [falhou, embedavel]);

  useEffect(() => {
    if (!visivel || !eTiktok || idTiktok || falhouTiktok) return;
    let cancelado = false;
    fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`)
      .then((resposta) => {
        if (!resposta.ok) throw new Error("oembed do tiktok falhou");
        return resposta.json() as Promise<{ embed_product_id?: string; html?: string }>;
      })
      .then((dados) => {
        if (cancelado) return;
        const id = dados.embed_product_id ?? dados.html?.match(/data-video-id="(\d+)"/)?.[1] ?? null;
        if (id) setIdTiktok(id);
        else setFalhouTiktok(true);
      })
      .catch(() => {
        if (!cancelado) setFalhouTiktok(true);
      });
    return () => {
      cancelado = true;
    };
  }, [visivel, eTiktok, idTiktok, falhouTiktok, url]);

  if (falhou || falhouTiktok) {
    return (
      <a href={linkExterno.href} className={styles.fallback}>
        {linkExterno.rotulo}
        <ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" />
      </a>
    );
  }

  if (visivel && idYoutube) {
    const src = new URL(`https://www.youtube.com/embed/${idYoutube}`);
    if (segundoInicial) src.searchParams.set("start", String(Math.trunc(segundoInicial)));
    return (
      <iframe
        className={styles.iframe}
        src={src.toString()}
        title={alt}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }

  if (visivel && urlInstagram) {
    return (
      <iframe
        className={styles.iframe}
        src={urlInstagram}
        title={alt}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }

  if (visivel && eTiktok && idTiktok) {
    return (
      <iframe
        className={styles.iframe}
        src={`https://www.tiktok.com/embed/v2/${idTiktok}`}
        title={alt}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }

  return (
    <div ref={ref} role="img" aria-label={alt} className={styles.marcador}>
      <Play size={32} strokeWidth={1.5} aria-hidden="true" />
      <span className={styles.rotuloCarregamento}>{rotuloCarregamento}</span>
    </div>
  );
}
