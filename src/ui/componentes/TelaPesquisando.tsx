"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { textosPesquisa } from "@/textos/pesquisa";

import { ClaqueteAnimada } from "./ClaqueteAnimada";
import estilosEspera from "./TelaEscrevendo.module.css";
import styles from "./TelaReescrevendo.module.css";

const t = textosPesquisa.espera;

/** Depois de quantos segundos o passo seguinte acende (a busca não informa o andamento: é um ritmo, não uma medida). */
const PASSO_DOIS_APOS_S = 15;
const PASSO_TRES_APOS_S = 40;
/** O tempo normal de uma pesquisa vai até 1 minuto e meio; depois disso a frase diz que está demorando, sem prometer nada. */
const LIMIAR_DEMORANDO_S = 120;
const LIMIAR_DEMORANDO_A_FUNDO_S = 180;

function formatar(segundos: number): string {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

/** O passo aceso para um tanto de segundos de espera (puro, para o teste). */
export function passoDaPesquisa(segundos: number): 0 | 1 | 2 {
  return segundos >= PASSO_TRES_APOS_S ? 2 : segundos >= PASSO_DOIS_APOS_S ? 1 : 0;
}

type Props = {
  aberto: boolean;
  /** O que a pessoa pediu para pesquisar, como escreveu. */
  pedido: string;
  /** A "Mais a fundo": leva até 2 minutos, não até 1 e meio. */
  aFundo?: boolean;
  aoVoltarDepois: () => void;
};

/**
 * A espera da pesquisa (passo 22 do Opus, estado `pesquisando`): a mesma tela da claquete batendo da V11, com a frase do pedido, os três passos, o tempo que leva, o contador e
 * "Voltar depois" (a pesquisa vive na fila e continua; o Criar diz que ela está lá). Cobre a tela inteira; quando a pesquisa termina, quem chama troca por o que ela achou.
 */
export function TelaPesquisando({ aberto, pedido, aFundo = false, aoVoltarDepois }: Props) {
  const [segundos, setSegundos] = useState(0);
  // A tela pode nascer aberta (a pesquisa ainda roda quando a pessoa chega): no servidor não há `document`, então o portal só existe depois da montagem.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  useEffect(() => {
    if (!aberto) {
      setSegundos(0);
      return;
    }
    const inicio = Date.now();
    const id = setInterval(() => setSegundos(Math.floor((Date.now() - inicio) / 1000)), 1000);
    return () => clearInterval(id);
  }, [aberto]);

  if (!aberto || !montado) return null;

  const passoAtual = passoDaPesquisa(segundos);
  const demorando = segundos >= (aFundo ? LIMIAR_DEMORANDO_A_FUNDO_S : LIMIAR_DEMORANDO_S);

  return createPortal(
    <div className={estilosEspera.tela} role="status" aria-live="polite" data-pesquisando>
      <div className={estilosEspera.miolo}>
        <ClaqueteAnimada altura={104} />
        <h2 className={estilosEspera.titulo}>{t.titulo}</h2>
        <p className={estilosEspera.frase}>
          {t.frase} <strong style={{ overflowWrap: "anywhere" }}>{pedido}</strong>
        </p>
        <ol className={styles.passos}>
          {t.passos.map((passo, indice) => {
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
        <p className={estilosEspera.duracao}>{aFundo ? t.duracaoAFundo : t.duracao}</p>
        <p className={estilosEspera.contador} aria-live="off">
          {formatar(segundos)}
        </p>
        {demorando ? <p className={estilosEspera.demorando}>{t.demorando}</p> : null}
        <button type="button" className={estilosEspera.botaoTexto} onClick={aoVoltarDepois}>
          {t.voltarDepois}
        </button>
      </div>
    </div>,
    document.body,
  );
}
