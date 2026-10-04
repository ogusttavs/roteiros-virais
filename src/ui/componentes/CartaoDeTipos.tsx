"use client";

import { textosTipos } from "@/textos/tipos";
import { useTiposDaMarca, type TipoLigado } from "@/ui/useTiposDaMarca";

import { Cartao } from "./Cartao";
import styles from "./CartaoDeTipos.module.css";
import { ListaDeTipos } from "./ListaDeTipos";
import listaStyles from "./ListaDeTipos.module.css";
import { ResumoDeTipos } from "./ResumoDeTipos";

type Props = {
  iniciais: readonly TipoLigado[];
  /** No Começar o texto explica o que já está ligado; no Briefing diz que cada troca vale a partir do próximo roteiro. */
  onde: "comecar" | "briefing";
  /** "3 de outubro": quando o cliente respondeu (só o Briefing já respondido mostra). */
  respondidoEm?: string | null;
};

/**
 * O cartão "Que tipos de vídeo combinam com você?" (passo 17 do Opus): no fim do último bloco do Começar e no Briefing. A chave já está na posição do padrão (oito ligadas
 * de treze); cada troca grava na hora, sem botão de salvar, e vale a partir do próximo roteiro. Os tipos não entram na nota.
 */
export function CartaoDeTipos({ iniciais, onde, respondidoEm }: Props) {
  const { estado, trocar, erro, ligados, trocados, total } = useTiposDaMarca(iniciais);
  const complemento = respondidoEm ? textosTipos.respondidoEm(respondidoEm) : trocados === 0 ? textosTipos.comoSugerimos : textosTipos.trocados(trocados);

  return (
    <Cartao className={styles.cartao} aria-labelledby={`titulo-tipos-${onde}`} id={onde === "briefing" ? "tipos-video" : undefined}>
      <div className={styles.topo}>
        <h3 id={`titulo-tipos-${onde}`}>{onde === "comecar" ? textosTipos.tituloCartao : textosTipos.tituloBriefing}</h3>
        <p className={styles.explica}>{onde === "comecar" ? textosTipos.explicaComecar : textosTipos.explicaBriefing}</p>
        <ResumoDeTipos ligados={ligados} total={total} complemento={complemento} />
      </div>
      <ListaDeTipos estado={estado} aoTrocar={trocar} sufixo={`-${onde}`} />
      {erro ? (
        <p className={listaStyles.erro} role="alert">
          {erro}
        </p>
      ) : null}
    </Cartao>
  );
}
