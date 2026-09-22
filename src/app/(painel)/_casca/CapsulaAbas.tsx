"use client";

import { Nav } from "@/ui/componentes/Nav";

import styles from "../layout.module.css";

import { useRolagemParaBaixo } from "./useRolagem";
import { useTecladoAberto } from "./useTeclado";

/**
 * A cápsula das abas (V5, item 5; IDENTIDADE.md: "a cápsula das abas
 * encolhe para só os ícones ao rolar para baixo e volta inteira ao
 * subir"). Mesmo sentido de rolagem que esconde o `CabecalhoCelular`
 * (`useRolagemParaBaixo`), só que aqui encolhe em vez de sumir: os quatro
 * destinos continuam sempre alcançáveis, só o rótulo escrito recolhe
 * (`Nav.module.css` mantém o nome para o leitor de tela).
 *
 * Some inteira com o teclado aberto (V7, item 0c): sem isso, ela ficava por
 * cima do campo em foco perto do fim da tela.
 */
export function CapsulaAbas() {
  const encolhida = useRolagemParaBaixo();
  const tecladoAberto = useTecladoAberto();

  const classes = [styles.barraInferior, encolhida ? styles.encolhida : "", tecladoAberto ? styles.escondidaTeclado : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <Nav encolhida={encolhida} />
    </div>
  );
}
