"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { rotuloParaQue } from "@/config/fichas";
import type { ItemPlano } from "@/servicos/plano";
import { textosPlano } from "@/textos/plano";
import { Botao } from "@/ui/componentes/Botao";
import { Folha } from "@/ui/componentes/Folha";
import { useTratarFalha } from "@/ui/ConexaoContext";

import styles from "./FolhaMeuPlano.module.css";
import { removerPlanoAction } from "./plano/acoes";

const FORMATAR_DATA = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "America/Sao_Paulo",
});

function formatarData(dataISO: string): string {
  const partes = FORMATAR_DATA.formatToParts(new Date(`${dataISO}T12:00:00`));
  const semana = (partes.find((p) => p.type === "weekday")?.value ?? "").replace("-feira", "");
  const dia = partes.find((p) => p.type === "day")?.value ?? "";
  const mes = (partes.find((p) => p.type === "month")?.value ?? "").replace(".", "");
  return `${semana}, ${dia} ${mes}`;
}

function agruparPorDia(itens: ItemPlano[]): { dia: string; itens: ItemPlano[] }[] {
  const grupos: { dia: string; itens: ItemPlano[] }[] = [];
  for (const item of itens) {
    const grupo = grupos.at(-1);
    if (grupo && grupo.dia === item.dia) grupo.itens.push(item);
    else grupos.push({ dia: item.dia, itens: [item] });
  }
  return grupos;
}

function rotuloEstado(estado: ItemPlano["estado"]): string | null {
  if (estado === "gravado") return textosPlano.rotuloGravado;
  if (estado === "aceito") return textosPlano.rotuloAceito;
  return null;
}

type Props = {
  aoFechar: () => void;
  itens: ItemPlano[];
  /** V12, item 4b: fecha esta folha e abre "Planejar os próximos dias" (estado dono do Hoje). */
  aoPlanejarDeNovo: () => void;
};

/**
 * "Meu plano" (V9b, item 3): só leitura, os dias que vêm a partir de hoje,
 * agrupados. V12, item 4b: "Tirar este plano" no pé, com a confirmação no
 * próprio pé (design v2, `MeuPlano.dc.html`, estado `tirando`); nada de
 * folha em cima de folha.
 */
export function FolhaMeuPlano({ aoFechar, itens, aoPlanejarDeNovo }: Props) {
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const grupos = agruparPorDia(itens);
  const [confirmandoTirar, setConfirmandoTirar] = useState(false);
  const [removendo, iniciarRemocao] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function tirarPlano() {
    setErro(null);
    iniciarRemocao(async () => {
      try {
        await removerPlanoAction();
        router.refresh();
        aoFechar();
      } catch (falha) {
        setErro(tratarFalha(falha, textosPlano.erroTirarPlano));
        setConfirmandoTirar(false);
      }
    });
  }

  return (
    <Folha
      titulo={textosPlano.tituloFolhaMeuPlano}
      aberto
      aoFechar={aoFechar}
      rodape={
        confirmandoTirar ? (
          <div className={styles.confirmarTirar}>
            <p>{textosPlano.confirmarTirarPlano}</p>
            {erro ? (
              <p className={styles.erro} role="alert">
                {erro}
              </p>
            ) : null}
            <div className={styles.duasAcoes}>
              <Botao variante="primario" tamanho="lg" precisaDeRede carregando={removendo} onClick={tirarPlano}>
                {removendo ? textosPlano.tirandoPlano : textosPlano.botaoTirarPlano}
              </Botao>
              <Botao variante="ghost" tamanho="md" disabled={removendo} onClick={() => setConfirmandoTirar(false)}>
                {textosPlano.botaoDeixarComoEsta}
              </Botao>
            </div>
          </div>
        ) : grupos.length > 0 ? (
          <>
            <Botao variante="secundario" tamanho="lg" onClick={aoPlanejarDeNovo}>
              {textosPlano.botaoPlanejarDeNovo}
            </Botao>
            <Botao variante="ghost" tamanho="md" onClick={() => setConfirmandoTirar(true)}>
              {textosPlano.botaoTirarPlano}
            </Botao>
          </>
        ) : (
          <Botao variante="primario" tamanho="lg" onClick={aoPlanejarDeNovo}>
            {textosPlano.botaoPlanejarDias}
          </Botao>
        )
      }
    >
      {grupos.length === 0 ? (
        <p className={styles.vazio}>{textosPlano.semPlano}</p>
      ) : (
        grupos.map((grupo) => (
          <div key={grupo.dia} className={styles.grupoDia}>
            <span className={styles.diaData}>{formatarData(grupo.dia)}</span>
            {grupo.itens.map((item) => (
              <div key={item.id} className={styles.item}>
                <div className={styles.itemCabecalho}>
                  <span className={styles.itemLugar}>{item.lugar.trim() || textosPlano.semLugar}</span>
                  {rotuloEstado(item.estado) ? (
                    <span className={styles.itemEstado}>{rotuloEstado(item.estado)}</span>
                  ) : null}
                </div>
                <p className={styles.itemSituacao}>{item.situacao}</p>
                <span className={styles.itemObjetivo}>{rotuloParaQue({ objetivo: item.objetivo, formato: item.formato })}</span>
              </div>
            ))}
          </div>
        ))
      )}
    </Folha>
  );
}
