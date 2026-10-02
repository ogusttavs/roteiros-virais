"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { MOTIVOS_REPROVACAO, type IdMotivoReprovacao } from "@/config/motivos-reprovacao";
import { textosRoteiro } from "@/textos/roteiro";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import chipStyles from "@/ui/componentes/Chips.module.css";
import { MotivoSemRede } from "@/ui/componentes/MotivoSemRede";
import { PainelFlutuante } from "@/ui/componentes/PainelFlutuante";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

import styles from "./FolhaReprovarAgenda.module.css";

const LIMIAR_DEMORANDO_MS = 10000;

type Props = {
  aberto: boolean;
  aoFechar: () => void;
  /** Reescreve e fica no mesmo dia (`reprovarERescrever` mantém `data`); quem chama decide o que
   * fazer com o roteiro novo (`id`) depois (E39c, parte 2a: só fecha e atualiza a agenda). */
  aoReprovar: (motivosIds: IdMotivoReprovacao[], motivoTexto: string | undefined) => Promise<{ id: number }>;
};

/**
 * "Não gostei, quero outro" do menu de três ações (E39c, parte 2a, pedido do Gustavo em 01/10,
 * 21:33): o mesmo reprovar com motivo que `/roteiros/[id]` já tem (`RoteiroTela.tsx`, o painel
 * "reprovar"), só que aberto direto da agenda, sem entrar no roteiro primeiro. Painel próprio em
 * vez de reusar o de lá: o de lá navega para a versão nova ao terminar (`fecharENavegar` com
 * `router.replace`), e aqui a pessoa quer continuar na agenda, só vendo o roteiro novo no lugar do
 * antigo quando a tela atualizar.
 */
export function FolhaReprovarAgenda({ aberto, aoFechar, aoReprovar }: Props) {
  const { semConexao } = useConexao();
  const tratarFalha = useTratarFalha();
  const [motivosSelecionados, setMotivosSelecionados] = useState<Set<IdMotivoReprovacao>>(new Set());
  const [motivoTexto, setMotivoTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [demorando, setDemorando] = useState(false);
  const [reescrevendo, iniciarReescrita] = useTransition();
  const reescritaEmCursoRef = useRef(false);

  useEffect(() => {
    if (!reescrevendo) {
      setDemorando(false);
      return;
    }
    const id = setTimeout(() => setDemorando(true), LIMIAR_DEMORANDO_MS);
    return () => clearTimeout(id);
  }, [reescrevendo]);

  function alternarMotivo(id: IdMotivoReprovacao) {
    setMotivosSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function fecharSeLivre() {
    if (reescritaEmCursoRef.current) return;
    setMotivosSelecionados(new Set());
    setMotivoTexto("");
    setErro(null);
    aoFechar();
  }

  function reprovar() {
    if (motivosSelecionados.size === 0 || semConexao) return;
    setErro(null);
    reescritaEmCursoRef.current = true;
    iniciarReescrita(async () => {
      try {
        await aoReprovar([...motivosSelecionados], motivoTexto.trim() || undefined);
        reescritaEmCursoRef.current = false;
        setMotivosSelecionados(new Set());
        setMotivoTexto("");
        aoFechar();
      } catch (falha) {
        reescritaEmCursoRef.current = false;
        setErro(tratarFalha(falha, textosRoteiro.reprovar.erro));
      }
    });
  }

  return (
    <PainelFlutuante
      titulo={reescrevendo ? textosRoteiro.reprovar.reescrevendo : textosRoteiro.reprovar.tituloFolha}
      aberto={aberto}
      aoFechar={fecharSeLivre}
      rodape={
        <>
          {erro ? (
            <p role="alert" className={styles.erro}>
              {erro}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reprovar}
            disabled={reescrevendo || semConexao || motivosSelecionados.size === 0}
            aria-busy={reescrevendo || undefined}
            className={styles.btn}
          >
            {reescrevendo ? textosRoteiro.reprovar.reescrevendo : textosRoteiro.reprovar.reescrever}
          </button>
          <MotivoSemRede />
          <p className={styles.aviso} aria-live="polite">
            {demorando
              ? textosRoteiro.reprovar.demorando
              : motivosSelecionados.size === 0
                ? textosRoteiro.reprovar.semMotivoMarcado
                : textosRoteiro.reprovar.tempoEstimado}
          </p>
          <button type="button" onClick={fecharSeLivre} disabled={reescrevendo} className={styles.cancelar}>
            {textosRoteiro.reprovar.cancelar}
          </button>
        </>
      }
    >
      <h2 className={styles.titulo}>
        {reescrevendo ? textosRoteiro.reprovar.reescrevendo : textosRoteiro.reprovar.tituloFolha}
      </h2>
      <p className={styles.ajuda}>{textosRoteiro.reprovar.ajudaMotivos}</p>
      <div role="group" aria-label={textosRoteiro.reprovar.rotuloMotivos} className={chipStyles.grupo}>
        {MOTIVOS_REPROVACAO.map((motivo) => {
          const ativo = motivosSelecionados.has(motivo.id);
          return (
            <button
              key={motivo.id}
              type="button"
              aria-pressed={ativo}
              onClick={() => alternarMotivo(motivo.id)}
              className={[chipStyles.chip, ativo ? chipStyles.ativo : ""].filter(Boolean).join(" ")}
            >
              {motivo.rotulo}
            </button>
          );
        })}
      </div>
      <AreaTexto
        rotulo={textosRoteiro.reprovar.rotuloTextoLivre}
        value={motivoTexto}
        onChange={(evento) => setMotivoTexto(evento.target.value)}
        placeholder={textosRoteiro.reprovar.textoLivrePlaceholder}
        linhasMin={3}
      />
    </PainelFlutuante>
  );
}
