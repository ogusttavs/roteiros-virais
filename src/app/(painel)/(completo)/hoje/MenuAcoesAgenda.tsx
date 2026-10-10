"use client";

import { Ellipsis, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type { IdMotivoReprovacao } from "@/config/motivos-reprovacao";
import { dadoOuErro } from "@/lib/resultado-acao";
import { textosComuns } from "@/textos/comuns";
import { textosHoje } from "@/textos/hoje";
import { ConfirmarMoverDia } from "@/ui/componentes/ConfirmarMoverDia";
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
  /**
   * E39c, parte 2b: a mesma regra do arrasto ("soltar num dia que já tem um item do mesmo
   * formato pede confirmação") também pelo "Não vou gravar hoje", para o caminho do teclado e o
   * do mouse nunca divergirem (achado do Fable na revisão: um barrando e o outro perguntando sem
   * avisar seria pior que os dois sem aviso nenhum). Quem chama já sabe o formato do item e os
   * dias que tem carregados (`SemanaTela`/`MesTela`); devolve a pergunta pronta quando há conflito
   * na data escolhida, `null` quando não há. Sem isto (as chamadas de `HojeTela.tsx`, fora desta
   * etapa), o "Mudar o dia" salva direto, como sempre foi.
   */
  perguntaSeConflito?: (novaData: string) => string | null;
  /**
   * E55 PR 2 (dúvida 5 do passo 21): o roteiro do tema do momento é para hoje. O menu não oferece "Não vou gravar hoje" e diz por quê; a saída é "Arquivar" (e "Não gostei, quero outro" continua,
   * porque a versão nova também é do momento).
   */
  doMomento?: boolean;
};

/**
 * "Tirar da frente sem abrir" (E39c, parte 2a, pedido do Gustavo em 01/10, 21:33): o menu de três
 * ações em todo item da agenda (o destaque do Reels, as linhas dos outros Reels e dos Stories, e
 * os itens da visão Semana do planejador), nas duas abas, Hoje e Planejar. Sem desenho novo: usa
 * as folhas que já existem (`FolhaMudarDia`, `FolhaReprovarAgenda`) e as ações que já existem
 * (`arquivarAtrasadoAction`, apesar do nome, serve qualquer roteiro, não só atrasado).
 */
export function MenuAcoesAgenda({ roteiroId, titulo, data, variante = "linha", aoArquivar, perguntaSeConflito, doMomento = false }: Props) {
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const idDaNota = useId();
  const [menuAberto, setMenuAberto] = useState(false);
  const { fechar: fecharMenu } = useFolhaNoHistorico(menuAberto, () => setMenuAberto(false));
  const [folhaMudarDiaAberta, setFolhaMudarDiaAberta] = useState(false);
  const [folhaReprovarAberta, setFolhaReprovarAberta] = useState(false);
  const [confirmarMudarDia, setConfirmarMudarDia] = useState<{ novaData: string; pergunta: string } | null>(null);
  const [ocupado, iniciarTransicao] = useTransition();
  const [movendo, iniciarMover] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function naoVouGravarHoje() {
    fecharMenu();
    setFolhaMudarDiaAberta(true);
  }

  async function efetivarMudarDia(novaData: string) {
    dadoOuErro(await mudarDataAtrasadoAction(roteiroId, novaData));
    setFolhaMudarDiaAberta(false);
    setConfirmarMudarDia(null);
    router.refresh();
  }

  async function salvarMudarDia(novaData: string) {
    const pergunta = novaData !== data ? perguntaSeConflito?.(novaData) : null;
    if (pergunta) {
      setFolhaMudarDiaAberta(false);
      setConfirmarMudarDia({ novaData, pergunta });
      return;
    }
    await efetivarMudarDia(novaData);
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

  function confirmarMoverMesmoAssim() {
    if (!confirmarMudarDia) return;
    iniciarMover(() => efetivarMudarDia(confirmarMudarDia.novaData));
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

      <PainelFlutuante titulo={textosHoje.agenda.menu.abrirRotulo(titulo)} aberto={menuAberto} aoFechar={fecharMenu} role="menu" descricaoId={doMomento ? idDaNota : undefined}>
        <div className={styles.cabecalho}>
          <h2 className={styles.titulo}>{textosHoje.agenda.menu.abrirRotulo(titulo)}</h2>
          <button type="button" className={styles.fechar} onClick={fecharMenu} aria-label={textosComuns.fechar}>
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        {doMomento ? null : (
          <button type="button" role="menuitem" className={styles.itemMenu} onClick={naoVouGravarHoje}>
            {textosHoje.agenda.menu.naoVouGravarHoje}
          </button>
        )}
        <button type="button" role="menuitem" className={styles.itemMenu} onClick={arquivar} disabled={ocupado}>
          {textosHoje.agenda.menu.arquivar}
        </button>
        <button type="button" role="menuitem" className={styles.itemMenu} onClick={naoGosteiQueroOutro}>
          {textosHoje.agenda.menu.naoGosteiQueroOutro}
        </button>
        {doMomento ? (
          <p id={idDaNota} className={styles.notaMomento}>
            {textosHoje.emAlta.naoMudaDeDia}
          </p>
        ) : null}
        {erro ? (
          <p role="alert" className={styles.erro}>
            {erro}
          </p>
        ) : null}
      </PainelFlutuante>

      {folhaMudarDiaAberta ? (
        <FolhaMudarDia aoFechar={() => setFolhaMudarDiaAberta(false)} dataInicial={data} aoSalvar={salvarMudarDia} />
      ) : null}

      {confirmarMudarDia ? (
        <ConfirmarMoverDia
          pergunta={confirmarMudarDia.pergunta}
          movendo={movendo}
          aoConfirmar={confirmarMoverMesmoAssim}
          aoCancelar={() => setConfirmarMudarDia(null)}
          confirmarRotulo={textosHoje.agenda.planejador.confirmarMoverBotao}
          cancelarRotulo={textosHoje.agenda.planejador.cancelarMoverBotao}
        />
      ) : null}

      <FolhaReprovarAgenda
        aberto={folhaReprovarAberta}
        aoFechar={() => setFolhaReprovarAberta(false)}
        aoReprovar={reprovar}
      />
    </>
  );
}
