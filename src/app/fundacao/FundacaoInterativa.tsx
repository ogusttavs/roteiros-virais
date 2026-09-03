"use client";

import { useState } from "react";

import { Botao } from "@/ui/componentes/Botao";
import { Toast } from "@/ui/componentes/Toast";
import { VideoEmbed } from "@/ui/componentes/VideoEmbed";

import styles from "./page.module.css";

/** As partes que precisam de estado local: aviso (toast) e o embed de video. */
export function FundacaoInterativa() {
  const [toastAberto, setToastAberto] = useState(false);

  return (
    <>
      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Aviso (toast)</h2>
        <div className={styles.demoToast}>
          <Botao variante="secundario" onClick={() => setToastAberto(true)}>
            Copiar roteiro
          </Botao>
          <Toast texto="Roteiro copiado" aberto={toastAberto} onFechar={() => setToastAberto(false)} />
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Embed de vídeo</h2>
        <div className={styles.linha}>
          <div style={{ width: 180 }}>
            <VideoEmbed
              url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
              alt="Vídeo de referência"
              rotuloCarregamento="vídeo embedado 9:16 · carrega ao entrar na tela"
              linkExterno={{ rotulo: "abrir o vídeo de referência", href: "https://www.youtube.com" }}
            />
          </div>
          <div style={{ width: 180 }}>
            <VideoEmbed
              url="https://www.tiktok.com/@exemplo/video/1"
              alt="Vídeo de referência"
              rotuloCarregamento="vídeo embedado 9:16"
              falhou
              linkExterno={{ rotulo: "abrir o vídeo", href: "https://www.tiktok.com" }}
            />
          </div>
        </div>
      </section>
    </>
  );
}
