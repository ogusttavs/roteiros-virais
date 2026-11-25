"use client";

import type { ReactNode } from "react";

import { useBarraRolada } from "@/app/(painel)/_casca/useRolagem";

import styles from "./BarraTopo.module.css";

type Props = {
  titulo: string;
  /** Botão de voltar, por exemplo (design v2, `Roteiro.dc.html`). */
  esquerda?: ReactNode;
  direita?: ReactNode;
  /** A tela já mostra o mesmo título grande no corpo da tela: o da barra só aparece depois que a tela rola (padrão do iPhone). */
  tituloAoRolar?: boolean;
};

/**
 * Barra fixa no topo da tela, com o nome da tela (design v2,
 * `entrega/telas/base.css`, `.barra-topo`; `PROXIMO.md`, D2 parte 1, item 3).
 *
 * Passo 17b, o cabeçalho de vidro (só abaixo de 768 px, `BarraTopo.module.css`): no topo da tela a barra não tem fundo nem fio, contínua com a faixa do relógio; rolada a
 * tela (`.rolada`, mais de 4 px), vira vidro com desfoque e o fio de baixo, e os botões da direita são bolhas de vidro de 44 px.
 */
export function BarraTopo({ titulo, esquerda, direita, tituloAoRolar = false }: Props) {
  const rolada = useBarraRolada();
  return (
    <header className={[styles.barra, rolada ? styles.rolada : "", tituloAoRolar ? styles.tituloAoRolar : ""].filter(Boolean).join(" ")} data-barra-topo="" data-rolada={rolada ? "" : undefined}>
      {esquerda}
      <span className={styles.titulo} aria-hidden={tituloAoRolar && !rolada ? true : undefined}>{titulo}</span>
      {direita ? <span className={styles.direita}>{direita}</span> : null}
    </header>
  );
}
