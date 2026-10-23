"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { DataMarcada, DataProxima } from "@/config/datas";
import { textosDatas } from "@/textos/datas";

import styles from "./CartaoDeData.module.css";

const MAXIMO_DE_LINHAS = 3;

/** Para onde o botão leva: o Tema livre com a data já escrita no campo (a pessoa ajusta o assunto na tela seguinte; nada é gerado por aqui). */
export function destinoDaData(data: Pick<DataMarcada, "nome">): string {
  return `/criar/tema-livre?tema=${encodeURIComponent(textosDatas.pontoDePartida(data.nome))}`;
}

type Props = {
  /** As datas de hoje. */
  hoje: DataMarcada[];
  /** As que chegam nos próximos dias, da mais perto para a mais longe. */
  proximas: DataProxima[];
  /**
   * "hoje": o cartão do Hoje (a frase e o botão). "sugestao": o cartão da tela de temas do Criar, que diz de onde vem o tema (a data) e a fonte dela,
   * porque ali a data aparece no lugar de um tema pesquisado.
   */
  variante: "hoje" | "sugestao";
};

/**
 * O cartão das datas (E60): "Hoje é Dia das Mães." e "Daqui a 7 dias é Dia dos Pais." com o botão que leva ao Tema livre com a data escrita. Sem nenhuma data que valha para a
 * marca, não desenha nada. No máximo três linhas, as de hoje primeiro, para nunca virar uma lista.
 */
export function CartaoDeData({ hoje, proximas, variante }: Props) {
  const router = useRouter();
  const [destino, setDestino] = useState<string | null>(null);
  const [abrindo, iniciarTransicao] = useTransition();

  const linhas = [
    ...hoje.map((data) => ({ data, frase: textosDatas.hoje(data.nome), ajuda: textosDatas.seEHoje })),
    ...proximas.map((data) => ({ data, frase: textosDatas.emDias(data.nome, data.dias), ajuda: textosDatas.seDaTempo })),
  ].slice(0, variante === "sugestao" ? 1 : MAXIMO_DE_LINHAS);
  if (linhas.length === 0) return null;

  function abrir(chave: string, url: string) {
    if (abrindo) return;
    setDestino(chave);
    iniciarTransicao(() => router.push(url));
  }

  return (
    <section className={styles.cartao} aria-labelledby={`t-datas-${variante}`} data-datas={variante}>
      <h2 id={`t-datas-${variante}`} className={styles.titulo}>
        {variante === "sugestao" ? textosDatas.sugestao.titulo : textosDatas.titulo}
      </h2>
      <ul className={styles.lista}>
        {linhas.map(({ data, frase, ajuda }) => (
          <li key={`${data.chave}-${data.data}`} className={styles.linha}>
            <span className={styles.selo}>{textosDatas.tipo[data.tipo]}</span>
            <p className={styles.frase}>{frase}</p>
            {variante === "sugestao" ? (
              <>
                <p className={styles.ajuda}>{textosDatas.sugestao.porQue(data.nome)}</p>
                <p className={styles.fonte}>{textosDatas.sugestao.fonte(data.fonte)}</p>
              </>
            ) : (
              <p className={styles.ajuda}>{ajuda}</p>
            )}
            <button
              type="button"
              className={styles.botao}
              disabled={abrindo}
              aria-busy={(abrindo && destino === data.chave) || undefined}
              onClick={() => abrir(data.chave, destinoDaData(data))}
            >
              {abrindo && destino === data.chave ? textosDatas.abrindo : variante === "sugestao" ? textosDatas.sugestao.botao : textosDatas.gravarSobre}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
