"use client";

import { useId } from "react";

import { textosMarcasDeFala } from "@/textos/marcas-de-fala";

import { ChaveLiga } from "./ChaveLiga";
import { ClaqueteAnimada } from "./ClaqueteAnimada";
import { ComoLerAsMarcas } from "./ComoLerAsMarcas";
import styles from "./LinhaMarcasDeFala.module.css";

type Props = {
  variante: "roteiro" | "gravacao";
  ligadas: boolean;
  aoTrocar: (ligar: boolean) => void;
  /** As marcas ainda estão sendo escritas (a primeira vez): a claquete e "Marcando a fala", com o texto à vista. */
  marcando: boolean;
  /** A frase da falha de quem ligou a chave; nula sem erro. */
  erro: string | null;
  avisos: { regra: string; texto: string }[];
};

/**
 * "Marcas de fala" (a chave), "Como ler as marcas" e a espera (E41 parte 2b; design v2, passo 24). No roteiro vem desligada e abre a linha das chaves do cartão; no modo gravação vem
 * ligada, pequena, embaixo do texto. Sem as marcas ainda, ligar a chave mostra a claquete e a frase, e o texto do roteiro continua inteiro à vista.
 */
export function LinhaMarcasDeFala({ variante, ligadas, aoTrocar, marcando, erro, avisos }: Props) {
  const idRotulo = useId();
  return (
    <div className={[styles.linha, variante === "roteiro" ? styles.roteiro : styles.gravacao].join(" ")} data-linha-marcas-de-fala="">
      <span className={styles.rotulo}>
        <span id={idRotulo}>{textosMarcasDeFala.chave}</span>
        <ChaveLiga ligada={ligadas} rotuladaPor={idRotulo} aoTrocar={aoTrocar} />
      </span>
      {ligadas ? (
        <ComoLerAsMarcas
          rotulo={variante === "roteiro" ? textosMarcasDeFala.comoLer : textosMarcasDeFala.comoLerCurto}
          pequeno={variante === "gravacao"}
          avisos={avisos}
        />
      ) : null}
      {ligadas && marcando ? (
        <p className={styles.espera} role="status" data-marcando-a-fala="">
          <ClaqueteAnimada altura={36} />
          <span>
            <strong>{textosMarcasDeFala.marcando}</strong>
            {textosMarcasDeFala.marcandoDetalhe}
          </span>
        </p>
      ) : null}
      {erro ? (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
