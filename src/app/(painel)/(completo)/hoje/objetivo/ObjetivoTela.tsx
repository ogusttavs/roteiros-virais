"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { Objetivo } from "@/db/schema";
import { AJUDA_OBJETIVO, NOME_OBJETIVO, OBJETIVOS_EM_ORDEM } from "@/ia/enums";
import type { OrigemRoteiro } from "@/servicos/roteiro";
import { textosComuns } from "@/textos/comuns";
import { textosObjetivo } from "@/textos/objetivo";
import { BarraAcao } from "@/ui/componentes/BarraAcao";
import { OpcaoObjetivo } from "@/ui/componentes/OpcaoObjetivo";
import { Progresso } from "@/ui/componentes/Progresso";

import { gerarRoteiroAction } from "./acoes";
import styles from "./ObjetivoTela.module.css";

const LIMIAR_DEMORANDO_MS = 10000;

function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

type Props = {
  origem: OrigemRoteiro;
  temaEscolhidoTexto: string;
  objetivoRecomendado: Objetivo | null;
};

/** `/hoje/objetivo` (etapa 11, brief-frontend.md 6.3; `ObjetivoFluxo.dc.html`). */
export function ObjetivoTela({ origem, temaEscolhidoTexto, objetivoRecomendado }: Props) {
  const router = useRouter();
  const [escolhido, setEscolhido] = useState<Objetivo | null>(null);
  const [erro, setErro] = useState(false);
  const [demorando, setDemorando] = useState(false);
  const [pendente, iniciarTransicao] = useTransition();

  useEffect(() => {
    if (!pendente) {
      setDemorando(false);
      return;
    }
    const id = setTimeout(() => setDemorando(true), LIMIAR_DEMORANDO_MS);
    return () => clearTimeout(id);
  }, [pendente]);

  function escrever() {
    if (!escolhido) return;
    setErro(false);
    iniciarTransicao(async () => {
      try {
        const { id } = await gerarRoteiroAction(origem, escolhido);
        router.push(`/roteiros/${id}`);
      } catch {
        setErro(true);
      }
    });
  }

  if (pendente) {
    return (
      <div className={styles.pagina}>
        <div className={styles.espera}>
          <Progresso frases={textosComuns.espera} />
          {demorando ? <p className={styles.demorando}>{textosObjetivo.demorando}</p> : null}
        </div>
      </div>
    );
  }

  if (erro) {
    return (
      <div className={styles.pagina}>
        <div className={styles.espera}>
          <p className={styles.fraseErro}>{textosObjetivo.erro}</p>
          <BarraAcao primaria={{ rotulo: textosComuns.tentarDeNovo, onClick: escrever }} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.temaEscolhido}>
        <span className={styles.rotulo}>{textosObjetivo.temaEscolhido}</span>
        <span className={styles.tema}>{temaEscolhidoTexto}</span>
      </div>

      <h1 className={styles.pergunta}>{textosObjetivo.pergunta}</h1>

      <div role="radiogroup" aria-label={textosObjetivo.pergunta} className={styles.opcoes}>
        {OBJETIVOS_EM_ORDEM.map((objetivo) => (
          <OpcaoObjetivo
            key={objetivo}
            titulo={primeiraMaiuscula(NOME_OBJETIVO[objetivo])}
            ajuda={AJUDA_OBJETIVO[objetivo]}
            marcada={escolhido === objetivo}
            recomendada={objetivoRecomendado === objetivo}
            rotuloRecomendado={textosObjetivo.recomendado}
            onEscolher={() => setEscolhido(objetivo)}
          />
        ))}
      </div>

      <BarraAcao
        secundaria={{ rotulo: textosComuns.voltar, onClick: () => router.back() }}
        primaria={{ rotulo: textosObjetivo.escrever, onClick: escrever, disabled: !escolhido }}
      />
    </div>
  );
}
