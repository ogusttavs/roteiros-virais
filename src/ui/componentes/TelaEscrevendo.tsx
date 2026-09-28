"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { textosComuns } from "@/textos/comuns";

import { ClaqueteAnimada } from "./ClaqueteAnimada";
import styles from "./TelaEscrevendo.module.css";

/** Depois de quanto tempo avisa que ainda está trabalhando (V11, item 3: um só lugar para os três caminhos). */
export const LIMIAR_DEMORANDO_MS = 10000;
const INTERVALO_FRASE_MS = 4000;

type Props = {
  /** Cobre a tela inteira enquanto true; some (sem nada no DOM) quando false, do jeito que `Folha` já faz. */
  aberto: boolean;
  /** A frase do caminho (tema, tema livre ou momento) para quando passa do limiar; null enquanto não demora. */
  fraseDemorando: string;
  /**
   * Presente só quando o pedido falhou e este caminho quer que a própria tela mostre o erro (troca
   * a espera pela frase e o botão de novo). Alguns caminhos preferem voltar para o formulário deles
   * mesmos em vez disso (a folha "Gravar agora", V11, item 3a): aí `erro` fica sempre `null` e o
   * `catch` de quem chama cuida da tela de erro.
   */
  erro?: string | null;
  aoTentarDeNovo?: () => void;
  /**
   * V11, item 4: presente só quando o pedido já está salvo no servidor (a
   * geração termina lá mesmo se a pessoa sair, `momento-continua-sem-espera.test.ts`)
   * e voltar depois é seguro; sem isto, o botão não aparece.
   */
  aoVoltarDepois?: () => void;
};

/**
 * O miolo da tela de espera, separado do portal (abaixo) só para o teste
 * unitário conseguir renderizar sem DOM de verdade (`renderToStaticMarkup`
 * nunca desenha o que vai para dentro de um `createPortal`).
 */
export function ConteudoTelaEscrevendo({
  fraseDemorando,
  erro,
  aoTentarDeNovo,
  aoVoltarDepois,
  demorando,
  frase,
}: {
  fraseDemorando: string;
  erro: string | null;
  aoTentarDeNovo?: () => void;
  aoVoltarDepois?: () => void;
  demorando: boolean;
  frase: string;
}) {
  return (
    <div className={styles.tela} role="status" aria-live="polite">
      <div className={styles.miolo}>
        <ClaqueteAnimada altura={96} />
        {erro !== null ? (
          <>
            <p className={styles.frase} role="alert">
              {erro}
            </p>
            <button type="button" className={styles.botao} onClick={aoTentarDeNovo}>
              {textosComuns.tentarDeNovo}
            </button>
          </>
        ) : (
          <>
            <h2 className={styles.titulo}>{textosComuns.esperaTitulo}</h2>
            <p className={styles.frase}>{frase}</p>
            <p className={styles.duracao}>{textosComuns.esperaDuracao}</p>
            {demorando ? <p className={styles.demorando}>{fraseDemorando}</p> : null}
            {demorando && aoVoltarDepois ? (
              <button type="button" className={styles.botaoTexto} onClick={aoVoltarDepois}>
                {textosComuns.esperaVoltarDepois}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A tela de espera com a claquete batendo (V11, item 2), a mesma para os
 * três caminhos que escrevem um roteiro (momento, tema, tema livre): cobre a
 * tela inteira, sem barra de abas, no lugar do círculo girando que cada tela
 * montava sozinha antes.
 */
export function TelaEscrevendo({ aberto, fraseDemorando, erro = null, aoTentarDeNovo, aoVoltarDepois }: Props) {
  const [indiceFrase, setIndiceFrase] = useState(0);
  const [demorando, setDemorando] = useState(false);

  useEffect(() => {
    if (!aberto || erro !== null) {
      setDemorando(false);
      return;
    }
    const id = setTimeout(() => setDemorando(true), LIMIAR_DEMORANDO_MS);
    return () => clearTimeout(id);
  }, [aberto, erro]);

  useEffect(() => {
    if (!aberto || erro !== null) return;
    const id = setInterval(
      () => setIndiceFrase((i) => (i + 1) % textosComuns.espera.length),
      INTERVALO_FRASE_MS,
    );
    return () => clearInterval(id);
  }, [aberto, erro]);

  if (!aberto) return null;

  return createPortal(
    <ConteudoTelaEscrevendo
      fraseDemorando={fraseDemorando}
      erro={erro}
      aoTentarDeNovo={aoTentarDeNovo}
      aoVoltarDepois={aoVoltarDepois}
      demorando={demorando}
      frase={textosComuns.espera[indiceFrase]}
    />,
    document.body,
  );
}
