import { Check } from "lucide-react";

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

type Estado = "normal" | "carregando" | "vazio" | "erro";

/**
 * Data, título e uma linha de estado no topo de `/hoje`, em todo estado
 * (design v2, `entrega/telas/Hoje.dc.html`, `.cabecalho-tela`). "normal"
 * cobre também o roteiro já gerado (mesma linha de constância nos dois,
 * `data-passo="normal gerado"` no design); os outros estados mostram uma
 * frase curta própria em vez da constância. Server Component puro, para
 * `page.tsx`, `loading.tsx` e `error.tsx` usarem sem precisar de
 * `"use client"`.
 *
 * `avisoVideoSubindo` (etapa 15, parte 1, decisão 4): uma linha curta
 * quando algum vídeo postado está acima do normal da própria conta, só no
 * estado normal, já formatada por quem chama.
 */
export function HojeCabecalho({
  constancia,
  avisoVideoSubindo = null,
  estado = "normal",
}: {
  constancia: Constancia;
  avisoVideoSubindo?: string | null;
  estado?: Estado;
}) {
  return (
    <div className={styles.cabecalhoTela}>
      <span className={styles.data}>{dataDeHojePorExtenso()}</span>
      <h1>{textosHoje.titulo}</h1>
      {estado === "normal" ? (
        <p className={styles.linhaConstancia}>
          <Check size={18} strokeWidth={1.75} className={styles.iconePositivo} aria-hidden="true" />
          <span>{fraseConstancia(constancia)}</span>
        </p>
      ) : estado === "carregando" ? (
        <p className={styles.fraseEstado}>{textosHoje.carregando}</p>
      ) : estado === "vazio" ? (
        <p className={styles.fraseEstado}>{textosHoje.vazioTitulo}</p>
      ) : (
        <p className={styles.fraseEstado}>{textosHoje.erroAviso}</p>
      )}
      {estado === "normal" && avisoVideoSubindo ? <p className={styles.avisoVideo}>{avisoVideoSubindo}</p> : null}
    </div>
  );
}
