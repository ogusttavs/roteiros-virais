"use client";

import { TrendingUp } from "lucide-react";

import type { AssuntoSemEncaixe } from "@/servicos/em-alta";
import { textosCriar } from "@/textos/criar";
import { textosHoje } from "@/textos/hoje";

import styles from "./SemEncaixeEmAlta.module.css";

const t = textosCriar.emAlta.semEncaixe;

type Props = {
  assuntos: AssuntoSemEncaixe[];
  desabilitado?: boolean;
  /** "Trazer para o meu ramo": leva a chave do assunto ao Tema livre. */
  aoTrazer: (assunto: AssuntoSemEncaixe) => void;
};

/** "Google e YouTube · desde ontem, 22h": de onde vem o assunto e desde quando está em alta, em uma linha mono. */
export function linhaDoAssuntoSemEncaixe(assunto: AssuntoSemEncaixe): string {
  return textosHoje.emAlta.linhaCurta(assunto.doGoogle, assunto.doYoutube, assunto.desde);
}

/**
 * O que está em alta no Brasil hoje e não coube no ramo da marca (até três, sem os assuntos delicados): o Criar não sugere tema, e cada linha leva o assunto ao Tema livre, já preso, para a
 * pessoa dizer como ele cabe no ramo e receber a nota antes do roteiro.
 */
export function SemEncaixeEmAlta({ assuntos, desabilitado = false, aoTrazer }: Props) {
  if (assuntos.length === 0) return null;
  return (
    <section className={styles.bloco} aria-labelledby="t-sem-encaixe" data-sem-encaixe>
      <span className={styles.origem}>
        <TrendingUp size={16} strokeWidth={1.75} aria-hidden="true" />
        {t.origem}
      </span>
      <h2 id="t-sem-encaixe">{t.titulo}</h2>
      <ul className={styles.lista}>
        {assuntos.map((assunto) => (
          <li key={assunto.chave}>
            <span className={styles.assunto}>
              <b>{assunto.assunto}</b>
              <span>{linhaDoAssuntoSemEncaixe(assunto)}</span>
            </span>
            <button type="button" className={styles.trazer} aria-label={t.trazerAria(assunto.assunto)} disabled={desabilitado} onClick={() => aoTrazer(assunto)}>
              {t.trazer}
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.explicacao}>{t.explicacao}</p>
      <p className={styles.delicado}>{t.delicado}</p>
    </section>
  );
}
