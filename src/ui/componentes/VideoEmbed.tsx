"use client";

import { ExternalLink, Play } from "lucide-react";
import { useEffect, useState } from "react";

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
const tPrevia = textosComuns.videoPrevia;

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
 * Embed oficial 9:16, com a capa e o play antes de tocar (RoteiroTela,
 * ReferenciasTela; desenho do passo 14, `entregaveis/design-v2/entrega/telas/base.css`,
 * `.moldura-video.previa-detalhe`). R2b, item 1: nada carrega sozinho, nem ao
 * entrar na tela; só o toque no play monta o embed de verdade, e só um vídeo
 * toca de cada vez porque cada `VideoEmbed` guarda o próprio estado. O
 * YouTube vira iframe só por transformação de URL (`youtube-nocookie.com/embed`,
 * com `autoplay=1` porque o toque já é o pedido de tocar); o TikTok não expõe
 * o id do vídeo de forma confiável em toda URL (link curto de compartilhamento
 * não traz o número), então o toque dispara uma chamada ao oEmbed oficial do
 * TikTok (`https://www.tiktok.com/oembed?url=`) só para extrair o id, sem
 * injetar o HTML nem o script que a resposta traz: o iframe final
 * (`/embed/v2/<id>`) é montado à mão, com a capa escurecida e "Carregando o
 * vídeo" enquanto isso. O Instagram vira iframe por transformação de URL
 * (`/reel/<codigo>/embed`); sem sinal de falha para ouvir, só o toque confere
 * a rede (`navigator.onLine`), e sem rede cai direto no reserva, sem tentar. O
 * reserva (a capa escurecida com "Abrir no <rede>") entra só em falha de
 * verdade: `falhou` vindo de fora, TikTok sem id, ou sem rede ao tocar.
 */
export function VideoEmbed({ url, alt, rotuloCarregamento, falhou = false, hrefExterno, segundoInicial, capaUrl = null }: Props) {
  const [tocando, setTocando] = useState(false);
  const [idTiktok, setIdTiktok] = useState<string | null>(null);
  const [falhouTiktok, setFalhouTiktok] = useState(false);
  const [falhouInstagram, setFalhouInstagram] = useState(false);
  const idYoutube = idDoYoutube(url);
  const urlInstagram = urlEmbedInstagram(url);
  const eTiktok = eUrlDoTiktok(url);
  const embedavel = Boolean(idYoutube) || Boolean(urlInstagram) || eTiktok;

  useEffect(() => {
    if (!tocando || !eTiktok || idTiktok || falhouTiktok) return;
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
  }, [tocando, eTiktok, idTiktok, falhouTiktok, url]);

  /**
   * O Instagram toca pelo `/embed` oficial dentro do iframe (prova da revisão da R2a, num
   * navegador de verdade e numa página https de outro domínio: a incorporação desenha e o play
   * toca ali dentro; em `http://localhost` ela vem em branco, e o pedido fora de iframe recebe
   * `X-Frame-Options: DENY`, por isso nenhum dos dois serve de prova). Sem sinal de falha para
   * ouvir, a única checagem possível é a rede no momento do toque.
   */
  function aoTocar() {
    if (urlInstagram && navigator.onLine === false) {
      setFalhouInstagram(true);
      return;
    }
    setTocando(true);
  }

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
          <span className={[styles.veu, styles.veuForte].join(" ")} aria-hidden="true" />
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

  // A capa com o play, antes do toque: nada carrega ainda, nem o oEmbed do TikTok.
  if (!tocando) {
    const rede = nomeDaRede(idYoutube, urlInstagram, eTiktok);
    return (
      <button type="button" className={styles.capaJogar} onClick={aoTocar} aria-label={tPrevia.tocar(alt)}>
        {capaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- url externa (CDN da plataforma), sem otimizacao do Next
          <img src={capaUrl} alt="" className={styles.capa} />
        ) : null}
        <span className={styles.veu} aria-hidden="true" />
        {rede ? <span className={styles.redePrevia}>{rede}</span> : null}
        {segundoInicial ? <span className={styles.comeca}>{tPrevia.comeca(segundoInicial)}</span> : null}
        <span className={styles.tocarIcone} aria-hidden="true">
          <Play size={28} strokeWidth={1.5} fill="currentColor" />
        </span>
      </button>
    );
  }

  // Tocado, mas o TikTok ainda não devolveu o id (a única espera de verdade: YouTube e Instagram montam na hora).
  if (eTiktok && !idTiktok) {
    return (
      <div className={styles.moldura} aria-label={alt}>
        {capaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- url externa (CDN da plataforma), sem otimizacao do Next
          <img src={capaUrl} alt="" className={styles.capa} />
        ) : null}
        <span className={[styles.veu, styles.veuForte].join(" ")} aria-hidden="true" />
        <div className={styles.carregando} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <span className={styles.rotuloCarregamento}>{rotuloCarregamento}</span>
        </div>
      </div>
    );
  }

  if (idYoutube) {
    const src = new URL(`https://www.youtube-nocookie.com/embed/${idYoutube}`);
    if (segundoInicial) src.searchParams.set("start", String(Math.trunc(segundoInicial)));
    src.searchParams.set("autoplay", "1");
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

  if (urlInstagram) {
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

  if (idTiktok) {
    return (
      <iframe
        className={styles.iframe}
        src={`https://www.tiktok.com/embed/v2/${idTiktok}?autoplay=1`}
        title={alt}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }

  return null;
}
