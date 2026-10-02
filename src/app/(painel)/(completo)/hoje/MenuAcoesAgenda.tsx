"use client";

import { Ellipsis, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { IdMotivoReprovacao } from "@/config/motivos-reprovacao";
import { textosComuns } from "@/textos/comuns";
import { textosHoje } from "@/textos/hoje";
import { PainelFlutuante } from "@/ui/componentes/PainelFlutuante";
import { useTratarFalha } from "@/ui/ConexaoContext";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import { reprovarERescreverAction } from "../roteiros/[id]/acoes";

import { mudarDataAtrasadoAction } from "./agenda-acoes";
import { FolhaMudarDia } from "./FolhaMudarDia";
import { FolhaReprovarAgenda } from "./FolhaReprovarAgenda";
import styles from "./MenuAcoesAgenda.module.css";

type Props = {
  roteiroId: number;
  titulo: string;
  data: string;
  /** "destaque": botão secundário ao lado de "Abrir o roteiro"; "linha": o ícone no lugar da seta
   * (a linha inteira continua abrindo o roteiro ao toque, fora deste botão). */
  variante?: "destaque" | "linha";
  /**
   * De `useDesfazerArquivar()`, de quem é dono da lista: o Toast com "Desfazer" precisa sobreviver
   * ao item sumir da lista quando `router.refresh()` termina, e este componente desmonta junto com
   * o item (achado desta rodada: o Toast morria antes da pessoa conseguir tocar em "Desfazer").
   */
  aoArquivar: (roteiroId: number) => Promise<void>;
};

/**
 * "Tirar da frente sem abrir" (E39c, parte 2a, pedido do Gustavo em 01/10, 21:33): o menu de três
 * ações em todo item da agenda (o destaque do Reels, as linhas dos outros Reels e dos Stories, e
 * os itens da visão Semana do planejador), nas duas abas, Hoje e Planejar. Sem desenho novo: usa
 * as folhas que já existem (`FolhaMudarDia`, `FolhaReprovarAgenda`) e as ações que já existem
 * (`arquivarAtrasadoAction`, apesar do nome, serve qualquer roteiro, não só atrasado).
 */
export function MenuAcoesAgenda({ roteiroId, titulo, data, variante = "linha", aoArquivar }: Props) {
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const [menuAberto, setMenuAberto] = useState(false);
  const { fechar: fecharMenu } = useFolhaNoHistorico(menuAberto, () => setMenuAberto(false));
  const [folhaMudarDiaAberta, setFolhaMudarDiaAberta] = useState(false);
  const [folhaReprovarAberta, setFolhaReprovarAberta] = useState(false);
  const [ocupado, iniciarTransicao] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function naoVouGravarHoje() {
    fecharMenu();
    setFolhaMudarDiaAberta(true);
  }

  async function salvarMudarDia(novaData: string) {
    await mudarDataAtrasadoAction(roteiroId, novaData);
    setFolhaMudarDiaAberta(false);
    router.refresh();
  }

  function arquivar() {
    if (ocupado) return;
    setErro(null);
    iniciarTransicao(async () => {
      try {
        await aoArquivar(roteiroId);
        fecharMenu();
      } catch (falha) {
        setErro(tratarFalha(falha, textosHoje.agenda.menu.erroArquivar));
      }
    });
  }

  function naoGosteiQueroOutro() {
    fecharMenu();
    setFolhaReprovarAberta(true);
  }

  async function reprovar(motivosIds: IdMotivoReprovacao[], motivoTexto: string | undefined) {
    const resultado = await reprovarERescreverAction(roteiroId, motivosIds, motivoTexto);
    router.refresh();
    return resultado;
  }

  return (
    <>
      <button
        type="button"
        className={variante === "destaque" ? styles.botaoDestaque : styles.botaoLinha}
        aria-label={textosHoje.agenda.menu.abrirRotulo(titulo)}
        aria-haspopup="menu"
        aria-expanded={menuAberto}
        onClick={(evento) => {
          evento.stopPropagation();
          setErro(null);
          setMenuAberto(true);
        }}
      >
        <Ellipsis size={variante === "destaque" ? 20 : 18} strokeWidth={1.75} aria-hidden="true" />
        {variante === "destaque" ? <span className={styles.rotuloDestaque}>{textosHoje.agenda.menu.abrir}</span> : null}
      </button>

      <PainelFlutuante titulo={textosHoje.agenda.menu.abrirRotulo(titulo)} aberto={menuAberto} aoFechar={fecharMenu} role="menu">
        <div className={styles.cabecalho}>
          <h2 className={styles.titulo}>{textosHoje.agenda.menu.abrirRotulo(titulo)}</h2>
          <button type="button" className={styles.fechar} onClick={fecharMenu} aria-label={textosComuns.fechar}>
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <button type="button" role="menuitem" className={styles.itemMenu} onClick={naoVouGravarHoje}>
          {textosHoje.agenda.menu.naoVouGravarHoje}
        </button>
        <button type="button" role="menuitem" className={styles.itemMenu} onClick={arquivar} disabled={ocupado}>
          {textosHoje.agenda.menu.arquivar}
        </button>
        <button type="button" role="menuitem" className={styles.itemMenu} onClick={naoGosteiQueroOutro}>
          {textosHoje.agenda.menu.naoGosteiQueroOutro}
        </button>
        {erro ? (
          <p role="alert" className={styles.erro}>
            {erro}
          </p>
        ) : null}
      </PainelFlutuante>

      {folhaMudarDiaAberta ? (
        <FolhaMudarDia aoFechar={() => setFolhaMudarDiaAberta(false)} dataInicial={data} aoSalvar={salvarMudarDia} />
      ) : null}

      <FolhaReprovarAgenda
        aberto={folhaReprovarAberta}
        aoFechar={() => setFolhaReprovarAberta(false)}
        aoReprovar={reprovar}
      />
    </>
  );
}
