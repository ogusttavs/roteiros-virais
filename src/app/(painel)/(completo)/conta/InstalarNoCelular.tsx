"use client";

import { useEffect, useState } from "react";

import { textosConta } from "@/textos/conta";
import { Cartao } from "@/ui/componentes/Cartao";

import styles from "./InstalarNoCelular.module.css";

/** O aplicativo já está instalado na tela de início? (Android e desktop: `display-mode`; iPhone: `navigator.standalone`.) */
function jaEstaInstalado(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * "Instalar no celular" (V7, item 5 do PROXIMO.md): as duas instruções curtas,
 * uma por sistema, só enquanto o aplicativo ainda não está instalado. Nada de
 * botão "instalar" (o navegador não deixa o iPhone fazer isso por código, e o
 * pedido do Android é a barra dele): o texto diz onde o cliente toca.
 *
 * Começa escondido e decide depois de montar, porque só o navegador sabe se
 * está instalado; o servidor não tem como saber, e um palpite dele daria
 * diferença na hidratação.
 */
export function InstalarNoCelular() {
  const [mostrar, setMostrar] = useState(false);

  useEffect(() => {
    setMostrar(!jaEstaInstalado());
  }, []);

  if (!mostrar) return null;

  const t = textosConta.instalar;
  return (
    <Cartao className={styles.instalar} data-testid="instalar-no-celular">
      <h3 className={styles.titulo}>{t.titulo}</h3>
      <p className={styles.explica}>{t.explica}</p>
      <ul className={styles.passos}>
        <li>
          <span className={styles.sistema}>{t.iphone.sistema}</span>
          <span>{t.iphone.passos}</span>
        </li>
        <li>
          <span className={styles.sistema}>{t.android.sistema}</span>
          <span>{t.android.passos}</span>
        </li>
      </ul>
    </Cartao>
  );
}
