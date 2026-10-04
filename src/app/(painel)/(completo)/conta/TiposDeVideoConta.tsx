"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { textosTipos } from "@/textos/tipos";
import { Botao } from "@/ui/componentes/Botao";
import { Folha } from "@/ui/componentes/Folha";
import { ListaDeTipos } from "@/ui/componentes/ListaDeTipos";
import listaStyles from "@/ui/componentes/ListaDeTipos.module.css";
import { ResumoDeTipos } from "@/ui/componentes/ResumoDeTipos";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";
import { useTiposDaMarca, type TipoLigado } from "@/ui/useTiposDaMarca";

import styles from "./TiposDeVideoConta.module.css";

/**
 * O cartão "Tipos de vídeo, 9 ligados de 13" da Conta (passo 17 do Opus, `Conta.dc.html`), irmão de "O seu briefing" no alto: abre a folha com a mesma lista, editável, com
 * "Pronto". Cada troca grava na hora e vale a partir do próximo roteiro (`useTiposDaMarca`). A folha é o padrão `Folha` (saída e arrasto da E51).
 */
export function TiposDeVideoConta({ iniciais }: { iniciais: readonly TipoLigado[] }) {
  const { estado, trocar, erro, ligados, total } = useTiposDaMarca(iniciais);
  const [aberta, setAberta] = useState(false);
  const { fechar } = useFolhaNoHistorico(aberta, () => setAberta(false));

  return (
    <>
      <button type="button" className={styles.linha} aria-haspopup="dialog" onClick={() => setAberta(true)}>
        <span className={styles.quem}>
          <strong>{textosTipos.conta.titulo}</strong>
          <span>{textosTipos.conta.resumo(ligados, total)}</span>
        </span>
        <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <Folha
        titulo={textosTipos.conta.titulo}
        aberto={aberta}
        aoFechar={fechar}
        rodape={
          <Botao variante="primario" tamanho="lg" onClick={fechar}>
            {textosTipos.conta.pronto}
          </Botao>
        }
      >
        <ResumoDeTipos ligados={ligados} total={total} complemento={textosTipos.conta.resumoDaFolha} />
        <ListaDeTipos estado={estado} aoTrocar={trocar} sufixo="-conta" />
        {erro ? (
          <p className={listaStyles.erro} role="alert">
            {erro}
          </p>
        ) : null}
      </Folha>
    </>
  );
}
