"use client";

import { Nav } from "@/ui/componentes/Nav";

import styles from "../layout.module.css";

import { useRolagemParaBaixo } from "./useRolagem";

/**
 * A cápsula das abas (V5, item 5; IDENTIDADE.md: "a cápsula das abas
 * encolhe para só os ícones ao rolar para baixo e volta inteira ao
 * subir"). Mesmo sentido de rolagem que esconde o `CabecalhoCelular`
 * (`useRolagemParaBaixo`), só que aqui encolhe em vez de sumir: os quatro
 * destinos continuam sempre alcançáveis, só o rótulo escrito recolhe
 * (`Nav.module.css` mantém o nome para o leitor de tela).
 */
export function CapsulaAbas() {
  const encolhida = useRolagemParaBaixo();

  return (
    <div className={encolhida ? `${styles.barraInferior} ${styles.encolhida}` : styles.barraInferior}>
      <Nav encolhida={encolhida} />
    </div>
  );
}
