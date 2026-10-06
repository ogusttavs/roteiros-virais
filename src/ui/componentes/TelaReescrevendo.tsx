"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { textosRoteiro } from "@/textos/roteiro";

import { ClaqueteAnimada } from "./ClaqueteAnimada";
import estilosEspera from "./TelaEscrevendo.module.css";
import styles from "./TelaReescrevendo.module.css";

const t = textosRoteiro.reprovar.espera;

/** Depois de quanto tempo o segundo passo vira o terceiro (a escrita não informa o andamento: é um ritmo, não uma medida). */
const PASSO_TRES_APOS_S = 25;

/** "a, b e c", com a primeira letra de cada motivo em minúscula (eles vêm como rótulo de botão). */
export function listaDeMotivos(motivos: string[]): string[] {
  return motivos.map((m) => m.charAt(0).toLowerCase() + m.slice(1));
}

type Props = {
  aberto: boolean;
  /** Os motivos que a pessoa marcou, como rótulos. */
  motivos: string[];
  /** "para que te chamem", "um Story, para quem já te segue": o que o roteiro continua sendo. */
  continuaSendo: string;
  aoVoltarDepois: () => void;
};

function formatar(segundos: number): string {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

/**
 * A espera da reescrita (passo 19 do Opus, estado `reescrevendo`): a mesma tela da claquete batendo da V11, com os três passos (guardando o que não gostou, reescrevendo sem o que a
 * pessoa marcou, conferindo para que o roteiro continua), o que ela marcou e "Voltar depois". Cobre a tela inteira; quando o roteiro novo chega, quem chama navega para ele.
 */
export function TelaReescrevendo({ aberto, motivos, continuaSendo, aoVoltarDepois }: Props) {
  const [segundos, setSegundos] = useState(0);

  useEffect(() => {
    if (!aberto) {
      setSegundos(0);
      return;
    }
    const inicio = Date.now();
    const id = setInterval(() => setSegundos(Math.floor((Date.now() - inicio) / 1000)), 1000);
    return () => clearInterval(id);
  }, [aberto]);

  if (!aberto) return null;

  const passoAtual = segundos >= PASSO_TRES_APOS_S ? 2 : 1;
  const passos = [t.passoGuardando, t.passoReescrevendo, t.passoConferindo(continuaSendo)];
  const marcados = listaDeMotivos(motivos);

  return createPortal(
    <div className={estilosEspera.tela} role="status" aria-live="polite" data-reescrevendo>
      <div className={estilosEspera.miolo}>
        <ClaqueteAnimada altura={96} />
        <h2 className={estilosEspera.titulo}>{t.titulo}</h2>
        <p className={estilosEspera.frase}>{t.subtitulo}</p>
        <ol className={styles.passos}>
          {passos.map((passo, indice) => {
            const estado = indice < passoAtual ? "feito" : indice === passoAtual ? "agora" : "depois";
            return (
              <li key={passo} className={styles.passo} data-passo={estado}>
                <span className={styles.marca} aria-hidden="true">
                  {estado === "feito" ? <Check size={14} strokeWidth={2} /> : null}
                </span>
                <span>{passo}</span>
              </li>
            );
          })}
        </ol>
        {marcados.length > 0 ? (
          <p className={styles.marcou} data-voce-marcou>
            {t.voceMarcou}{" "}
            {marcados.map((m, i) => (
              <span key={m}>
                <strong>{m}</strong>
                {i < marcados.length - 2 ? ", " : i === marcados.length - 2 ? " e " : ""}
              </span>
            ))}
          </p>
        ) : null}
        <p className={estilosEspera.duracao}>{t.duracao}</p>
        <p className={estilosEspera.contador} aria-live="off">
          {formatar(segundos)}
        </p>
        <button type="button" className={estilosEspera.botaoTexto} onClick={aoVoltarDepois}>
          {t.voltarDepois}
        </button>
      </div>
    </div>,
    document.body,
  );
}
