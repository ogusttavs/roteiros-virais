"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import styles from "../layout.module.css";

import { CapsulaNav } from "./CapsulaNav";
import { useCapsulaEncolhida } from "./useRolagem";
import { useTecladoAberto } from "./useTeclado";

/**
 * A cápsula das abas (V5, item 5; A3, item 5: a regra do passo 16 do Opus). Encolhe para só os ícones ao rolar para baixo, FICA encolhida ao soltar o dedo, na
 * inércia e no quique, e abre com 40 px de subida no mesmo gesto, a 20 px do topo, ao trocar de aba ou ao tocar num ícone (`regraDaCapsula`, `useRolagem.ts`).
 * Encolhe em vez de sumir (o `CabecalhoCelular` também não some mais ao rolar, decisão 122): os quatro
 * lugares (Hoje, Criar, Planejar, Mais; `CapsulaNav.tsx`, passo 13 do Opus)
 * continuam sempre alcançáveis, só o rótulo escrito recolhe (`Nav.module.css`
 * mantém o nome para o leitor de tela).
 *
 * Some inteira com o teclado aberto (V7, item 0c): sem isso, ela ficava por
 * cima do campo em foco perto do fim da tela.
 */
export function CapsulaAbas() {
  const { encolhida, abrir } = useCapsulaEncolhida();
  const pathname = usePathname();

  // Trocou de aba (ou entrou em outra tela): a cápsula abre, e a tela nova começa do topo dela (passo 16: "lugar novo, nomes de novo").
  useEffect(() => {
    abrir();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `abrir` só reinicia a regra; o que dispara é a troca de rota.
  }, [pathname]);
  const tecladoAberto = useTecladoAberto();

  const classes = [styles.barraInferior, encolhida ? styles.encolhida : "", tecladoAberto ? styles.escondidaTeclado : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <CapsulaNav encolhida={encolhida} aoTocar={abrir} />
    </div>
  );
}
