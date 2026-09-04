import type { Constancia } from "@/servicos/temas";
import { textosHoje } from "@/textos/hoje";

import styles from "./HojeTela.module.css";

function fraseConstancia(constancia: Constancia): string {
  if (constancia.tipo === "primeiro_dia") return textosHoje.constancia.primeiroDia;
  if (constancia.tipo === "seguidos") return textosHoje.constancia.seguidos(constancia.dias);
  return textosHoje.constancia.parado(constancia.dias);
}

const DATA_POR_EXTENSO = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

function dataDeHojePorExtenso(): string {
  const texto = DATA_POR_EXTENSO.format(new Date());
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Data e constância no topo de `/hoje`, em todo estado, inclusive o vazio
 * (etapa 12, decisão 4 do `PROXIMO.md`, `HojeCelular.dc.html`: só essa
 * linha, não o componente `Constancia` inteiro). Server Component puro,
 * para o estado vazio de `page.tsx` usar sem precisar de `"use client"`.
 */
export function HojeCabecalho({ constancia }: { constancia: Constancia }) {
  return (
    <div className={styles.cabecalho}>
      <span className={styles.data}>{dataDeHojePorExtenso()}</span>
      <h1 className={styles.titulo}>{textosHoje.titulo}</h1>
      <p className={styles.constancia}>{fraseConstancia(constancia)}</p>
    </div>
  );
}
