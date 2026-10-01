"use client";

import { useState, useTransition } from "react";

import { textosHoje } from "@/textos/hoje";
import { Botao } from "@/ui/componentes/Botao";
import { Folha } from "@/ui/componentes/Folha";
import { PerguntaParaQuando } from "@/ui/componentes/PerguntaAgendamento";
import { useTratarFalha } from "@/ui/ConexaoContext";

import styles from "./FolhaMudarDia.module.css";

type Props = {
  aoFechar: () => void;
  dataInicial: string;
  aoSalvar: (novaData: string) => Promise<void>;
};

/**
 * "Mudar o dia" num atrasado (E39b, item b): a mesma pergunta "para quando é" da E39a, numa folha
 * à parte porque o atrasado é uma troca pontual, não o fluxo inteiro de Criar.
 */
export function FolhaMudarDia({ aoFechar, dataInicial, aoSalvar }: Props) {
  const tratarFalha = useTratarFalha();
  const [data, setData] = useState(dataInicial);
  const [salvando, iniciarSalvar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function salvar() {
    setErro(null);
    iniciarSalvar(async () => {
      try {
        await aoSalvar(data);
      } catch (falha) {
        setErro(tratarFalha(falha, textosHoje.agenda.atrasado.erroSalvar));
      }
    });
  }

  return (
    <Folha
      titulo={textosHoje.agenda.atrasado.mudarODia}
      aberto
      aoFechar={aoFechar}
      rodape={
        <Botao variante="primario" tamanho="lg" precisaDeRede carregando={salvando} onClick={salvar}>
          {salvando ? textosHoje.agenda.atrasado.salvando : textosHoje.agenda.atrasado.salvar}
        </Botao>
      }
    >
      <PerguntaParaQuando data={data} onChange={setData} />
      {erro ? (
        <p role="alert" className={styles.erro}>
          {erro}
        </p>
      ) : null}
    </Folha>
  );
}
