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

/**
 * Embed oficial 9:16, carregamento tardio ao entrar na tela (RoteiroTela,
 * ReferenciasTela). So o YouTube tem embed oficial sem SDK externo; TikTok e
 * Instagram usam o link de fallback ate a etapa que integrar os SDKs deles
 * (fora do escopo desta etapa, que so troca visual).
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
  const ref = useRef<HTMLDivElement>(null);
  const idYoutube = idDoYoutube(url);

  useEffect(() => {
    if (!ref.current || falhou || !idYoutube) return;
    const observer = new IntersectionObserver(
      ([entrada]) => {
        if (entrada.isIntersecting) setVisivel(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [falhou, idYoutube]);

  if (falhou) {
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

  return (
    <div ref={ref} role="img" aria-label={alt} className={styles.marcador}>
      <Play size={32} strokeWidth={1.5} aria-hidden="true" />
      <span className={styles.rotuloCarregamento}>{rotuloCarregamento}</span>
    </div>
  );
}
