"use client";

import styles from "../layout.module.css";

import { CapsulaNav } from "./CapsulaNav";
import { useTecladoAberto } from "./useTeclado";

/**
 * A barra de abas do celular (V5, item 5; refeita em 25/11/2026, pedido do Gustavo: "a parte de baixo fica meio que flutuando quando não deveria"). Presa na borda de baixo, de ponta a ponta,
 * como a barra de abas de um aplicativo nativo do iPhone: sempre inteira, com os quatro lugares (Hoje, Criar, Planejar, Mais; `CapsulaNav.tsx`) e o rótulo à vista, na mesma altura
 * (`--altura-barra-abas` mais a área segura), para o fim de toda tela terminar acima dela. Antes encolhia para só os ícones ao rolar para baixo (`regraDaCapsula`, `useRolagem.ts`);
 * uma barra que muda de altura e de largura enquanto se rola é o que fazia ela parecer solta.
 *
 * Some inteira com o teclado aberto (V7, item 0c): sem isso, ela ficava por cima do campo em foco perto do fim da tela.
 */
export function CapsulaAbas() {
  const tecladoAberto = useTecladoAberto();

  const classes = [styles.barraInferior, tecladoAberto ? styles.escondidaTeclado : ""].filter(Boolean).join(" ");

  return (
    <div className={classes} data-capsula-abas="">
      <div className={styles.capsula}>
        <CapsulaNav />
      </div>
    </div>
  );
}
