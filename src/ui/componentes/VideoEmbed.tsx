"use client";

import { ExternalLink, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { textosComuns } from "@/textos/comuns";

import styles from "./VideoEmbed.module.css";

export type VideoEmbedProps = {
  url: string;
  alt: string;
  /** Ja formatado ("Carregando o vídeo"). */
  rotuloCarregamento: string;
  /** Quando o ator/API nao devolve embed oficial para a plataforma (TikTok e Instagram hoje). */
  falhou?: boolean;
  /** Só o endereço: o texto do botão do reserva ("Abrir no Instagram") vem do nome da rede, que a própria URL já diz. */
  hrefExterno: string;
  /** O embed já carrega começando neste segundo (RoteiroTela, "olha como ele faz aos X"). */
  segundoInicial?: number;
  /** R2a: a capa do vídeo, para a moldura escurecida do reserva quando a rede não deixa mostrar o embed. */
  capaUrl?: string | null;
};

type Props = VideoEmbedProps;

const t = textosComuns.videoReserva;

function nomeDaRede(idYoutube: string | null, urlInstagram: string | null, eTiktok: boolean): string | null {
  if (idYoutube) return "YouTube";
  if (urlInstagram) return "Instagram";
  if (eTiktok) return "TikTok";
  return null;
}

/** Quanto esperar a resposta do TikTok antes de mostrar só o link (V7, item 4 do PROXIMO.md). */
const TEMPO_LIMITE_OEMBED_MS = 8000;

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
 * ReferenciasTela; desenho do passo 14, `entregaveis/design-v2/entrega/telas/base.css`,
 * `.moldura-video`). O YouTube vira iframe só por transformação de URL
 * (`youtube-nocookie.com/embed`); o TikTok não expõe o id do vídeo de forma
 * confiável em toda URL (link curto de compartilhamento não traz o número),
 * então o carregamento tardio dispara uma chamada ao oEmbed oficial do TikTok
 * (`https://www.tiktok.com/oembed?url=`) só para extrair o id do vídeo, sem
 * injetar o HTML nem o script que a resposta traz: o iframe final
 * (`/embed/v2/<id>`) é montado à mão. O Instagram vira iframe por
 * transformação de URL (`/reel/<codigo>/embed`). O reserva (a capa escurecida
 * com "Abrir no <rede>") entra só em falha de verdade: `falhou` vindo de fora,
 * TikTok sem id, ou sem rede. A capa com o play antes de tocar (o estado `previa` do
 * desenho) fica para a R2b; aqui o carregamento continua automático ao
 * entrar na tela.
 */
export function VideoEmbed({ url, alt, rotuloCarregamento, falhou = false, hrefExterno, segundoInicial, capaUrl = null }: Props) {
  const [visivel, setVisivel] = useState(false);
  const [idTiktok, setIdTiktok] = useState<string | null>(null);
  const [falhouTiktok, setFalhouTiktok] = useState(false);
  const [falhouInstagram, setFalhouInstagram] = useState(false);
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
    // Rede ruim não deixa o bloco 9:16 em "Carregando o vídeo" sem fim (V7, item 4 do PROXIMO.md): sem rede nem
    // tenta, e com rede lenta desiste em 8 s. Nos dois casos cai no reserva, pelo mesmo caminho da falha
    // (assíncrono).
    const pedido =
      navigator.onLine === false
        ? Promise.reject(new Error("sem rede"))
        : fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
            signal: AbortSignal.timeout(TEMPO_LIMITE_OEMBED_MS),
          });
    pedido
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

  useEffect(() => {
    // O Instagram toca pelo `/embed` oficial dentro do iframe (prova da revisão da R2a, num navegador de
    // verdade e numa página https de outro domínio: a incorporação desenha e o play toca ali dentro; em
    // `http://localhost` ela vem em branco, e o pedido fora de iframe recebe `X-Frame-Options: DENY`, por
    // isso nenhum dos dois serve de prova). Não há sinal de falha para ouvir, então o reserva do
    // Instagram só entra sem rede, o mesmo caso em que o TikTok nem tenta.
    if (!visivel || !urlInstagram || falhouInstagram) return;
    if (navigator.onLine === false) setFalhouInstagram(true);
  }, [visivel, urlInstagram, falhouInstagram]);

  if (falhou || falhouTiktok || falhouInstagram) {
    const rede = nomeDaRede(idYoutube, urlInstagram, eTiktok);
    // Sempre há uma rede aqui: as três falhas só disparam depois de a URL já ter sido
    // reconhecida como uma das três (achado próprio é o caso de baixo, `!embedavel`, sem rede
    // nenhuma reconhecida, que não tem o que escrever no botão).
    if (rede) {
      return (
        <div className={styles.moldura} aria-label={alt}>
          {capaUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- url externa (CDN da plataforma), sem otimizacao do Next
            <img src={capaUrl} alt="" className={styles.capa} />
          ) : null}
          <span className={styles.veu} aria-hidden="true" />
          <div className={styles.reserva}>
            <p>{t.texto(rede)}</p>
            <a href={hrefExterno} className={styles.botaoReserva}>
              <ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" />
              {t.abrir(rede)}
            </a>
          </div>
        </div>
      );
    }
  }

  if (!embedavel) return null;

  if (visivel && idYoutube) {
    const src = new URL(`https://www.youtube-nocookie.com/embed/${idYoutube}`);
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
