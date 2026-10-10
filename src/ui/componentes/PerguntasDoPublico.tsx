"use client";

import type { ReactNode } from "react";

import { Botao } from "./Botao";
import styles from "./PerguntasDoPublico.module.css";

/** Uma pergunta (ou reclamação) pronta para a tela: `vezesTexto` já vem escrito ("perguntado 14 vezes"). */
export type PerguntaNaTela = { chave: string; texto: string; vezesTexto: string };

type ListaProps = {
  perguntas: PerguntaNaTela[];
  /** O texto do botão de cada linha ("Responder em vídeo", ou "Responder" na porta do Criar). */
  rotuloDoBotao: string;
  /** O nome acessível do botão de cada linha, com a pergunta dentro. */
  nomeDoBotao: (texto: string) => string;
  aoResponder: (chave: string) => void;
  /** A chave que está abrindo agora (o botão dela diz que abre; os outros ficam parados). */
  abrindo?: string | null;
  desabilitado?: boolean;
  textoAbrindo?: string;
};

/** A lista de perguntas, com o botão de responder em cada linha. Sem `<h2>` nem cartão: quem usa decide a moldura. */
export function ListaDePerguntas({ perguntas, rotuloDoBotao, nomeDoBotao, aoResponder, abrindo = null, desabilitado = false, textoAbrindo = "Abrindo" }: ListaProps) {
  return (
    <ul className={styles.lista} data-lista-perguntas>
      {perguntas.map((pergunta) => (
        <li key={pergunta.chave} className={styles.item}>
          <span className={styles.texto}>
            {pergunta.texto}
            <span className={styles.vezes}>{pergunta.vezesTexto}</span>
          </span>
          <Botao
            variante="secundario"
            tamanho="md"
            precisaDeRede
            aria-label={nomeDoBotao(pergunta.texto)}
            aria-busy={abrindo === pergunta.chave || undefined}
            disabled={desabilitado}
            onClick={() => aoResponder(pergunta.chave)}
          >
            {abrindo === pergunta.chave ? textoAbrindo : rotuloDoBotao}
          </Botao>
        </li>
      ))}
    </ul>
  );
}

type BlocoProps = ListaProps & {
  rotulo: string;
  titulo: string;
  /** "Dos comentários dos 12 vídeos mais vistos do seu setor no YouTube, lidos em 11 de outubro. É a nossa leitura: ninguém é citado pelo nome." */
  leitura: string;
  /** Um botão no canto do topo (o "Recolher" das Referências). */
  acao?: ReactNode;
  /** `h2` nas Referências, `h3` onde a tela já tem um `h2`. */
  nivelDoTitulo?: 2 | 3;
  id: string;
};

/** O bloco inteiro: o rótulo pequeno, o título, a lista e a frase da leitura. */
export function BlocoDePerguntas({ rotulo, titulo, leitura, acao, nivelDoTitulo = 3, id, ...lista }: BlocoProps) {
  const Titulo = nivelDoTitulo === 2 ? "h2" : "h3";
  return (
    <section className={styles.bloco} aria-labelledby={id} data-perguntas-do-publico>
      <div className={[styles.topo, acao ? styles.topoComAcao : ""].filter(Boolean).join(" ")}>
        <div className={styles.topo}>
          <span className={styles.rotulo}>{rotulo}</span>
          <Titulo id={id} className={styles.titulo}>
            {titulo}
          </Titulo>
        </div>
        {acao}
      </div>
      <ListaDePerguntas {...lista} />
      <p className={styles.leitura}>{leitura}</p>
    </section>
  );
}
