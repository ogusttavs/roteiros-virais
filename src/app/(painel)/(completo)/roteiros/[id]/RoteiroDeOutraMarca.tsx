"use client";

import { Repeat } from "lucide-react";
import Link from "next/link";

import { useTrocaMarca } from "@/app/(painel)/_casca/TrocaMarcaContext";
import { textosNav } from "@/textos/nav";
import { textosRoteiro } from "@/textos/roteiro";
import { Botao } from "@/ui/componentes/Botao";

import styles from "./RoteiroDeOutraMarca.module.css";

type Props = {
  marca: { id: number; nome: string };
  roteiroId: number;
};

/**
 * O roteiro existe e é de outra marca a que a pessoa também tem acesso (um link guardado, o histórico do navegador). Em vez de cair no Hoje sem explicação, diz de qual marca é e
 * oferece trocar para ela, pela mesma troca do seletor de marca do painel. Ela revalida a rota, e a página que mostra esta tela leva ao roteiro quando ele já é da marca ativa.
 */
export function RoteiroDeOutraMarca({ marca, roteiroId }: Props) {
  const { trocar, trocando, erro } = useTrocaMarca();
  const t = textosRoteiro.deOutraMarca;
  return (
    <div className={styles.tela} data-roteiro-de-outra-marca>
      <Repeat size={24} strokeWidth={1.5} aria-hidden="true" />
      <p className={styles.frase}>{t.frase(marca.nome)}</p>
      <div className={styles.acoes}>
        <Botao type="button" precisaDeRede carregando={trocando} onClick={() => trocar(marca.id, marca.nome, { roteiroId })} data-trocar-para-marca>
          {trocando ? textosNav.abrindoMarca(marca.nome) : t.trocar(marca.nome)}
        </Botao>
        <Link href="/hoje" className={styles.voltar}>
          {t.voltar}
        </Link>
      </div>
      {erro ? (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
