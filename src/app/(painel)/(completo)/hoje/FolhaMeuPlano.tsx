"use client";

import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { ItemPlano } from "@/servicos/plano";
import { textosPlano } from "@/textos/plano";
import { Folha } from "@/ui/componentes/Folha";

import styles from "./FolhaMeuPlano.module.css";

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
};

/** "Meu plano" (V9b, item 3): só leitura, os dias que vêm a partir de hoje, agrupados. */
export function FolhaMeuPlano({ aoFechar, itens }: Props) {
  const grupos = agruparPorDia(itens);

  return (
    <Folha titulo={textosPlano.tituloFolhaMeuPlano} aberto aoFechar={aoFechar}>
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
                <span className={styles.itemObjetivo}>{ROTULO_TEMA_CARTAO[item.objetivo]}</span>
              </div>
            ))}
          </div>
        ))
      )}
    </Folha>
  );
}
