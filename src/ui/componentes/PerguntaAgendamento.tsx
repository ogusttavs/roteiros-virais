"use client";

import { useState } from "react";

import type { MomentoDoDia } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { textosCriar } from "@/textos/criar";

import { Chips } from "./Chips";
import styles from "./PerguntaAgendamento.module.css";

/** Mesma ordem de `MOMENTOS_DO_DIA` (`db/schema.ts`); só o tipo entra deste módulo, nunca o
 * valor (nada de `import { MOMENTOS_DO_DIA } from "@/db/schema"` num componente de cliente). */
const OPCOES_MOMENTO_DO_DIA: { valor: MomentoDoDia; rotulo: string }[] = [
  { valor: "manha", rotulo: textosCriar.manha },
  { valor: "meio_dia", rotulo: textosCriar.meioDia },
  { valor: "fim_tarde", rotulo: textosCriar.fimDaTarde },
  { valor: "noite", rotulo: textosCriar.noite },
];

function somarDiasISO(dataISO: string, dias: number): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia + dias);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

const FORMATAR_DIA_EXTENSO = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });

function diaExtenso(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return FORMATAR_DIA_EXTENSO.format(new Date(ano, mes - 1, dia));
}

type PropsParaQuando = {
  data: string;
  onChange: (data: string) => void;
};

/**
 * "Para quando é?" (E39a, Criar.dc.html; dúvida 10: o mesmo bloco muda de lugar em cada
 * caminho, mas é sempre este). Hoje (padrão), Amanhã ou uma data escolhida no calendário do
 * próprio aparelho (`input type="date"`, mesmo padrão de `FolhaPlanejarDias.tsx`). O aviso de
 * frescor aparece embutido, sem tela à parte, quando a data escolhida não é hoje.
 */
export function PerguntaParaQuando({ data, onChange }: PropsParaQuando) {
  const hoje = hojeISO();
  const amanha = somarDiasISO(hoje, 1);
  const outraDataInicial = data !== hoje && data !== amanha;
  /**
   * O modo é estado próprio, não deduzido só de `data`: tocar em "Escolher a data" tem que marcar
   * o terceiro chip na hora, mesmo que a data ainda não tenha mudado (achado da prova manual desta
   * etapa: sem isto, tocar o chip com `data` já em "amanhã" não tirava a marca de "Amanhã").
   */
  const [modo, setModo] = useState<0 | 1 | 2>(outraDataInicial ? 2 : data === amanha ? 1 : 0);

  function escolher(indice: number) {
    const indiceValido = indice === 1 ? 1 : indice === 2 ? 2 : 0;
    setModo(indiceValido);
    if (indiceValido === 0) onChange(hoje);
    else if (indiceValido === 1) onChange(amanha);
    else if (data === hoje || data === amanha) onChange(somarDiasISO(hoje, 2));
  }

  return (
    <div className={styles.grupo}>
      <Chips
        rotuloGrupo={textosCriar.paraQuando}
        rotuloVisivel={textosCriar.paraQuando}
        opcoes={[textosCriar.hoje, textosCriar.amanha, textosCriar.escolherData]}
        selecionado={modo}
        onChange={escolher}
      />
      {modo === 2 ? (
        <label className={styles.campoData}>
          <span>{textosCriar.escolherData}</span>
          <input
            type="date"
            aria-label={textosCriar.escolherData}
            value={data}
            min={hoje}
            onChange={(evento) => evento.target.value && onChange(evento.target.value)}
            className={styles.inputData}
          />
        </label>
      ) : null}
      {data !== hoje ? <p className={styles.avisoFrescor}>{textosCriar.avisoFrescor(diaExtenso(data))}</p> : null}
    </div>
  );
}

type PropsMomentoDoDia = {
  valor: MomentoDoDia | null;
  onChange: (valor: MomentoDoDia) => void;
};

/** "Em que momento do dia?" (E39a), só perguntado quando o formato é Story. */
export function PerguntaMomentoDoDia({ valor, onChange }: PropsMomentoDoDia) {
  const indiceSelecionado = valor ? OPCOES_MOMENTO_DO_DIA.findIndex((opcao) => opcao.valor === valor) : null;

  return (
    <div className={styles.grupo}>
      <span className={styles.rotulo}>{textosCriar.momentoDoDia}</span>
      <p className={styles.ajuda}>{textosCriar.momentoDoDiaAjuda}</p>
      <Chips
        rotuloGrupo={textosCriar.momentoDoDia}
        opcoes={OPCOES_MOMENTO_DO_DIA.map((opcao) => opcao.rotulo)}
        selecionado={indiceSelecionado === -1 ? null : indiceSelecionado}
        onChange={(indice) => onChange(OPCOES_MOMENTO_DO_DIA[indice].valor)}
      />
    </div>
  );
}
