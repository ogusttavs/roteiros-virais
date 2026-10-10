"use client";

import { TrendingUp, History } from "lucide-react";
import type { ReactNode } from "react";

import type { CartaoEmAlta as DadosDoCartao } from "@/servicos/em-alta";
import { textosHoje } from "@/textos/hoje";

import styles from "./CartaoEmAlta.module.css";

const t = textosHoje.emAlta;

type Props = {
  cartao: DadosDoCartao;
  /** "principal": o botão é o principal da tela (num dia sem nada marcado, e no Criar); senão é o contorno, para não competir com o roteiro marcado (dúvida 3 do passo 21). */
  destaque: "principal" | "secundario";
  /** O botão do cartão: "Criar o roteiro" quando ainda não há roteiro, "Abrir o roteiro" quando há (ou "Quero esse" no Criar, que passa o próprio rótulo). */
  rotuloDoBotao?: string;
  ocupado?: boolean;
  aoClicar: () => void;
  /** O menu de três ações (`MenuAcoesAgenda`), só depois que o roteiro existe. */
  menu?: ReactNode;
  /** O rótulo de estado do roteiro criado ("a gravar", "gravado", "postado"). */
  estado?: string;
  /** Mais uma ação ao lado do botão, como "Trazer para o meu ramo de outro jeito" no Criar. */
  acaoExtra?: ReactNode;
};

/** A linha mono do cartão: de onde vem o assunto e desde quando está em alta. */
export function linhaDaFonte(cartao: DadosDoCartao): string {
  const fonte = t.fonte(cartao.doGoogle, cartao.doYoutube);
  return cartao.desde ? `${fonte} · ${t.desde(cartao.desde.dia, cartao.desde.hora)}` : fonte;
}

/** O número que prova o assunto: as buscas do Google quando existem; sem número, só o que se sabe (vem do YouTube), nunca um valor inventado. */
export function provaDoAssunto(cartao: DadosDoCartao): string | null {
  if (cartao.buscas) return t.buscas(cartao.buscas);
  return cartao.doYoutube && !cartao.doGoogle ? t.soYoutube : null;
}

/**
 * O cartão "Em alta hoje" (E55 PR 2, passo 21 do Opus): o assunto que está em alta no Brasil hoje, o tema dele trazido para o ramo da marca ("No seu ramo") e o botão de criar o roteiro.
 * O contorno na cor de seleção é o único da tela: é a única coisa que tem prazo. Vale só no dia e não muda de dia; quem usa decide o que o botão faz e passa o menu quando já há roteiro.
 */
export function CartaoEmAlta({ cartao, destaque, rotuloDoBotao, ocupado = false, aoClicar, menu, estado, acaoExtra }: Props) {
  const prova = provaDoAssunto(cartao);
  const rotulo = rotuloDoBotao ?? (cartao.roteiro ? t.abrirRoteiro : t.criarRoteiro);
  return (
    <article className={styles.cartao} data-em-alta={cartao.assunto}>
      <div className={styles.topo}>
        <span className={styles.origem}>
          <TrendingUp size={16} strokeWidth={1.75} aria-hidden="true" />
          {t.origem}
        </span>
        <span className={styles.selo}>{t.paraHoje}</span>
        {menu}
      </div>

      <div className={styles.oQue}>
        <h3 className={styles.assunto}>{cartao.assunto}</h3>
        <p className={styles.fonte}>{linhaDaFonte(cartao)}</p>
        {prova ? <p className={styles.prova}>{prova}</p> : null}
      </div>

      <div className={styles.noSeuRamo}>
        <span className={styles.rotuloRamo}>{t.noSeuRamo}</span>
        <h4>{cartao.tema.titulo}</h4>
        <p className={styles.facil}>{cartao.tema.descricao}</p>
        {estado ? <span className={styles.estado}>{estado}</span> : null}
        <div className={styles.acoes}>
          <button
            type="button"
            className={destaque === "principal" ? styles.botaoPrimario : styles.botaoSecundario}
            aria-busy={ocupado || undefined}
            disabled={ocupado}
            onClick={aoClicar}
          >
            {rotulo}
          </button>
          {acaoExtra}
        </div>
      </div>

      <p className={styles.vale}>
        <History size={16} strokeWidth={1.75} aria-hidden="true" />
        {t.valeEnquanto}
      </p>
    </article>
  );
}
