"use client";

import { useState } from "react";

import { textosMarcasDeFala } from "@/textos/marcas-de-fala";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import styles from "./ComoLerAsMarcas.module.css";
import { MarcaDeDevagar, MarcaDePausa, MarcaDePeso, MarcaDeTom } from "./FalaMarcada";
import { Folha } from "./Folha";

type Props = {
  /** O texto do botão: "Como ler as marcas" no roteiro, "Como ler" (pequeno) no modo gravação. */
  rotulo: string;
  pequeno?: boolean;
  /** Os avisos que valem só para este roteiro (R-FALA-01, 04, 14 e 15), em texto de apoio, nunca como marca. */
  avisos?: { regra: string; texto: string }[];
};

/**
 * O botão e a folha "Como ler as marcas" (E41 parte 2b; design v2, passo 24, `legendaMarcas` no roteiro e `legenda` no modo gravação): as seis marcas com o exemplo desenhado, o
 * tom do bloco, "não existe marca de rápido", os avisos deste roteiro e, no pé, a frase fixa da voz (R-FALA-24), escrita pelo código e nunca pelo modelo. Do tablet para cima a
 * folha é uma janela no meio (o `Folha` de sempre); o Voltar do celular fecha a folha em vez de sair da tela.
 */
export function ComoLerAsMarcas({ rotulo, pequeno = false, avisos = [] }: Props) {
  const [aberta, setAberta] = useState(false);
  const { fechar } = useFolhaNoHistorico(aberta, () => setAberta(false));
  const t = textosMarcasDeFala.legenda;

  return (
    <>
      <button type="button" className={[styles.botao, pequeno ? styles.botaoPequeno : ""].filter(Boolean).join(" ")} onClick={() => setAberta(true)}>
        {rotulo}
      </button>
      {aberta ? (
        <Folha titulo={t.titulo} aberto={aberta} aoFechar={fechar}>
          <ul className={styles.lista}>
            <li>
              <span className={styles.exemplo}>
                <MarcaDePeso>{t.exemplos.peso}</MarcaDePeso>
              </span>
              <strong>{t.peso.nome}</strong>
              <p>{t.peso.explica}</p>
            </li>
            <li>
              <span className={styles.exemplo}>
                {t.exemplos.fim}
                <MarcaDePausa duracao="curta" />
              </span>
              <strong>{t.pausaCurta.nome}</strong>
              <p>{t.pausaCurta.explica}</p>
            </li>
            <li>
              <span className={styles.exemplo}>
                {t.exemplos.fim}
                <MarcaDePausa duracao="longa" />
              </span>
              <strong>{t.pausaLonga.nome}</strong>
              <p>{t.pausaLonga.explica}</p>
            </li>
            <li>
              <span className={styles.exemplo}>
                <MarcaDeDevagar>{t.exemplos.devagar}</MarcaDeDevagar>
              </span>
              <strong>{t.devagar.nome}</strong>
              <p>{t.devagar.explica}</p>
            </li>
            <li>
              <span className={styles.exemplo}>
                {t.exemplos.desce}
                <MarcaDeTom direcao="desce" />
              </span>
              <strong>{t.tomDesce.nome}</strong>
              <p>{t.tomDesce.explica}</p>
            </li>
            <li>
              <span className={styles.exemplo}>
                {t.exemplos.sobe}
                <MarcaDeTom direcao="sobe" />
              </span>
              <strong>{t.tomSobe.nome}</strong>
              <p>{t.tomSobe.explica}</p>
            </li>
            <li>
              <span className={styles.exemplo}>
                <b>{t.exemplos.tom}</b>
              </span>
              <strong>{t.tomDoBloco.nome}</strong>
              <p>{t.tomDoBloco.explica}</p>
            </li>
          </ul>
          {avisos.length > 0 ? (
            <section className={styles.paraEsteRoteiro} aria-label={textosMarcasDeFala.paraEsteRoteiro}>
              <h4>{textosMarcasDeFala.paraEsteRoteiro}</h4>
              {avisos.map((aviso, indice) => (
                <p key={`${aviso.regra}-${indice}`}>{aviso.texto}</p>
              ))}
            </section>
          ) : null}
          <p className={styles.nota}>{t.notaRapido}</p>
          <p className={styles.nota}>{textosMarcasDeFala.fraseDaVoz}</p>
        </Folha>
      ) : null}
    </>
  );
}
